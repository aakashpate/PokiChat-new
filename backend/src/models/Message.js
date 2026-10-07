const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
      maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    text: {
      type: String,
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
      default: '',
    },
    type: {
      type: String,
      enum: ['text', 'image'],
      default: 'text',
    },
    imageUrl: {
      type: String,
      default: null,
    },
    reactions: {
      type: Object,
      default: () => ({}),
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    readBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: () => [],
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Message', messageSchema);
