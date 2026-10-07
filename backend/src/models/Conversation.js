const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['direct'],
      default: 'direct',
    },
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
    },
    lastMessage: {
      text: {
        type: String,
        default: '',
        maxlength: [1000, 'Message cannot exceed 1000 characters'],
      },
      type: {
        type: String,
        enum: ['text', 'image'],
        default: 'text',
      },
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      at: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: true,
  }
);

conversationSchema.index({ participants: 1 }, { unique: true });

conversationSchema.methods.includesUser = function includesUser(userId) {
  return this.participants.some((participant) => String(participant._id || participant) === String(userId));
};

module.exports = mongoose.model('Conversation', conversationSchema);
