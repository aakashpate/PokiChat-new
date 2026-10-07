const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken } = require('../config/jwt');

const SALT_ROUNDS = 10;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

const badRequest = (res, message) => res.status(400).json({ success: false, message });

const issueSession = (user) => ({
  token: signToken({
    sub: String(user._id),
    username: user.username,
    ver: Number(user.tokenVersion) || 0,
  }),
  user: user.toSelf(),
});

exports.register = async (req, res, next) => {
  try {
    const { username = '', email = '', password = '', confirmPassword = '' } = req.body || {};

    const trimmedUsername = String(username).trim();
    const trimmedEmail = String(email).trim().toLowerCase();

    if (!trimmedUsername || !trimmedEmail || !password) {
      return badRequest(res, 'Username, email and password are required');
    }

    if (!User.USERNAME_PATTERN.test(trimmedUsername)) {
      return badRequest(
        res,
        'Username must be 3-30 characters and may only contain letters, numbers, spaces, dots and underscores'
      );
    }

    if (!User.EMAIL_PATTERN.test(trimmedEmail)) {
      return badRequest(res, 'Please provide a valid email address');
    }

    if (String(password).length < PASSWORD_MIN || String(password).length > PASSWORD_MAX) {
      return badRequest(res, `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`);
    }

    if (password !== confirmPassword) {
      return badRequest(res, 'Passwords do not match');
    }

    const usernameKey = trimmedUsername.toLowerCase();

    const existingUser = await User.findOne({
      $or: [{ usernameKey }, { email: trimmedEmail }],
    });

    if (existingUser) {
      const conflict =
        existingUser.usernameKey === usernameKey ? 'Username already taken' : 'Email already registered';
      return res.status(409).json({ success: false, message: conflict });
    }

    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const user = await User.create({
      username: trimmedUsername,
      usernameKey,
      email: trimmedEmail,
      passwordHash,
    });

    res.status(201).json({ success: true, data: issueSession(user) });
  } catch (error) {
    if (error && error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || '';
      const message =
        field === 'email'
          ? 'Email already registered'
          : field === 'usernameKey'
            ? 'Username already taken'
            : 'Account already exists';
      return res.status(409).json({ success: false, message });
    }
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { identifier = '', password = '' } = req.body || {};

    const trimmedIdentifier = String(identifier).trim();

    if (!trimmedIdentifier || !password) {
      return badRequest(res, 'Email/username and password are required');
    }

    const asKey = trimmedIdentifier.toLowerCase();
    const user = await User.findOne({
      $or: [{ email: asKey }, { usernameKey: asKey }],
    }).select('+passwordHash');

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'Incorrect email/username or password' });
    }

    const matches = await bcrypt.compare(String(password), user.passwordHash);
    if (!matches) {
      return res
        .status(401)
        .json({ success: false, message: 'Incorrect email/username or password' });
    }

    user.lastSeen = new Date();
    await user.save();

    res.status(200).json({ success: true, data: issueSession(user) });
  } catch (error) {
    next(error);
  }
};

exports.me = (req, res) => {
  res.json({ success: true, data: req.user.toSelf() });
};

exports.logout = async (req, res, next) => {
  try {
    req.user.tokenVersion = Number(req.user.tokenVersion || 0) + 1;
    req.user.lastSeen = new Date();
    await req.user.save();
    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    next(error);
  }
};
