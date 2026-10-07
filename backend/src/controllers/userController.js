const User = require('../models/User');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.searchUsers = async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();

    if (!query) {
      return res.status(400).json({ success: false, message: 'Search query is required' });
    }

    if (query.length > 100) {
      return res.status(400).json({ success: false, message: 'Search query is too long' });
    }

    const pattern = new RegExp(escapeRegex(query), 'i');
    const currentUserId = req.auth.userId;

    const users = await User.find({
      _id: { $ne: currentUserId },
      $or: [{ username: pattern }, { email: pattern }],
    })
      .sort({ username: 1 })
      .limit(20);

    res.json({
      success: true,
      data: users.map((user) => user.toPublic()),
    });
  } catch (error) {
    next(error);
  }
};

exports.getPresence = async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 50);

    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'ids query parameter is required' });
    }

    const users = await User.find({ _id: { $in: ids } }).select('username lastSeen');

    res.json({
      success: true,
      data: users.map((user) => ({
        _id: user._id,
        username: user.username,
        lastSeen: user.lastSeen,
      })),
    });
  } catch (error) {
    next(error);
  }
};
