const fs = require('fs');
const path = require('path');
const Upload = require('../models/Upload');
const { isDBConnected } = require('../config/database');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isSafeFilename = (filename) => FILENAME_PATTERN.test(filename);

const diskPath = (filename) => path.join(UPLOADS_DIR, filename);

const existsOnDisk = (filename) => fs.existsSync(diskPath(filename));

const saveUpload = async ({ filename, contentType, buffer }) => {
  if (!isDBConnected()) return false;

  try {
    await Upload.updateOne(
      { filename },
      { $set: { filename, contentType, size: buffer.length, data: buffer } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error(`Failed to store upload ${filename} in MongoDB: ${error.message}`);
    return false;
  }
};

const getUpload = async (filename) => {
  if (!isDBConnected() || !isSafeFilename(filename)) return null;
  return Upload.findOne({ filename });
};

const imageAvailable = async (imageUrl) => {
  const filename = path.basename(String(imageUrl || ''));

  if (!isSafeFilename(filename)) return false;
  if (existsOnDisk(filename)) return true;

  return Boolean(await getUpload(filename));
};

const serveFromDisk = (upload) => {
  try {
    const target = diskPath(upload.filename);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.writeFileSync(target, upload.data);
    }
    return true;
  } catch (error) {
    console.warn(`Could not rehydrate upload ${upload.filename}: ${error.message}`);
    return false;
  }
};

module.exports = {
  isSafeFilename,
  existsOnDisk,
  saveUpload,
  getUpload,
  imageAvailable,
  serveFromDisk,
  diskPath,
};
