import mongoose from 'mongoose';

const marketDataSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    index: true,
    uppercase: true
  },
  price: {
    type: Number,
    required: true
  },
  open: Number,
  high: Number,
  low: Number,
  volume: Number,
  change: Number,
  changePercent: Number,
  pe: Number,
  marketCap: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(+new Date() + 24*60*60*1000), // 24 hours
    index: { expires: 0 } // TTL index
  }
});

export const MarketData = mongoose.model('MarketData', marketDataSchema);
