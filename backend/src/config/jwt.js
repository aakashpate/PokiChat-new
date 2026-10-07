const jwt = require('jsonwebtoken');

const DEV_SECRET = 'pokichat-dev-only-secret';

const getJwtSecret = () => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Provide a strong secret in the server environment (see backend/.env.example).'
    );
  }

  return DEV_SECRET;
};

const assertJwtConfig = () => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Provide a strong secret in the server environment (see backend/.env.example).'
    );
  }
  if (!secret) {
    console.warn('WARNING: JWT_SECRET missing - falling back to the built-in development secret.');
    console.warn('WARNING: Never run with a missing JWT_SECRET in production.');
  }
};

const signToken = (payload) =>
  jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    issuer: 'pokichat',
  });

const verifyToken = (token) => jwt.verify(token, getJwtSecret(), { issuer: 'pokichat' });

module.exports = { signToken, verifyToken, assertJwtConfig };
