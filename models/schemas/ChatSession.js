import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  symbol: {
    type: String,
    default: null,
  },
  marketData: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
}, { _id: true, timestamps: { createdAt: 'timestamp', updatedAt: false } });

const chatSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  title: {
    type: String,
    default: 'New Chat',
    maxlength: 100,
  },
  messages: {
    type: [messageSchema],
    default: [],
  },
  lastSymbol: {
    type: String,
    default: null,
  },
  pinned: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

// Auto-index for fast lookup
chatSessionSchema.index({ userId: 1, updatedAt: -1 });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

export default ChatSession;
