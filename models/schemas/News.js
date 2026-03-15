import mongoose from 'mongoose';

const newsSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    sparse: true
  },
  symbol: {
    type: String,
    required: true,
    index: true,
    uppercase: true
  },
  headline: {
    type: String,
    required: true
  },
  summary: String,
  source: String,
  url: String,
  imageUrl: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  sentiment: {
    type: String,
    enum: ['positive', 'neutral', 'negative'],
    default: 'neutral'
  },
  expiresAt: {
    type: Date,
    default: () => new Date(+new Date() + 7*24*60*60*1000), // 7 days
    index: { expires: 0 }
  }
});

export const News = mongoose.model('News', newsSchema);
