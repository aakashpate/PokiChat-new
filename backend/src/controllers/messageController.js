const fs = require('fs/promises');
const { isDBConnected } = require('../config/database');
const { listMessages, createMessage: persistMessage } = require('../store/messages');
const { saveUpload, diskPath } = require('../store/uploads');

exports.getHealth = (req, res) => {
  res.json({
    success: true,
    message: 'PokiChat API is running',
    database: isDBConnected() ? 'connected' : 'memory',
    timestamp: new Date().toISOString(),
  });
};

exports.getMessages = async (req, res, next) => {
  try {
    const messages = await listMessages();
    res.json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};

exports.createMessage = async (req, res, next) => {
  try {
    const { username, text } = req.body;

    if (!username || !text) {
      return res.status(400).json({
        success: false,
        message: 'Username and text are required',
      });
    }

    const trimmedUsername = username.trim();
    const trimmedText = text.trim();

    if (!trimmedUsername || !trimmedText) {
      return res.status(400).json({
        success: false,
        message: 'Username and text cannot be empty',
      });
    }

    if (trimmedUsername.length > 30) {
      return res.status(400).json({
        success: false,
        message: 'Username cannot exceed 30 characters',
      });
    }

    if (trimmedText.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot exceed 1000 characters',
      });
    }

    const message = await persistMessage({
      username: trimmedUsername,
      text: trimmedText,
    });

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
};

exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const buffer = await fs.readFile(diskPath(req.file.filename));
    await saveUpload({
      filename: req.file.filename,
      contentType: req.file.mimetype,
      buffer,
    });

    res.status(200).json({
      success: true,
      data: {
        imageUrl: `/uploads/${req.file.filename}`,
        filename: req.file.filename,
      },
    });
  } catch (error) {
    next(error);
  }
};
