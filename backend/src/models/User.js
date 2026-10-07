const mongoose = require('mongoose');

const USERNAME_PATTERN = /^[A-Za-z0-9_. ]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
      match: [USERNAME_PATTERN, 'Username may only contain letters, numbers, spaces, dots and underscores'],
    },
    usernameKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email is too long'],
      match: [EMAIL_PATTERN, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('validate', function assignUsernameKey(next) {
  if (this.username) {
    this.usernameKey = this.username.trim().toLowerCase();
  }
  next();
});

userSchema.methods.toPublic = function toPublic() {
  return {
    _id: this._id,
    username: this.username,
    lastSeen: this.lastSeen,
    createdAt: this.createdAt,
  };
};

userSchema.methods.toSelf = function toSelf() {
  return { ...this.toPublic(), email: this.email };
};

module.exports = mongoose.model('User', userSchema);
module.exports.USERNAME_PATTERN = USERNAME_PATTERN;
module.exports.EMAIL_PATTERN = EMAIL_PATTERN;
