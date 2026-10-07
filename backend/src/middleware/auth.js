const { verifyToken } = require('../config/jwt');
const User = require('../models/User');

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
};

const invalidSession = (res, error) => {
  const message =
    error && error.name === 'TokenExpiredError'
      ? 'Session expired. Please log in again.'
      : 'Invalid session. Please log in again.';
  return res.status(401).json({ success: false, message });
};

const requireAuth = (req, res, next) => {
  const token = readToken(req);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const payload = verifyToken(token);
    req.auth = {
      userId: String(payload.sub),
      username: payload.username,
      ver: Number(payload.ver) || 0,
    };
    next();
  } catch (error) {
    return invalidSession(res, error);
  }
};

const loadUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.userId).select('+tokenVersion');
    if (!user || Number(user.tokenVersion || 0) !== Number(req.auth.ver || 0)) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const verifySocketToken = (token) => {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return {
      userId: String(payload.sub),
      username: payload.username,
      ver: Number(payload.ver) || 0,
    };
  } catch (error) {
    return null;
  }
};

module.exports = { requireAuth, loadUser, verifySocketToken };
