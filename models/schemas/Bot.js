import mongoose from 'mongoose';

const botSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Bot name is required'],
      trim: true,
      maxlength: [100, 'Bot name cannot exceed 100 characters'],
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    type: {
      type: String,
      required: [true, 'Bot type is required'],
      index: true,
    },
    version: {
      type: String,
      default: '1.0.0',
      required: true,
    },
    fileName: {
      type: String,
      required: [true, 'File name is required'],
    },
    filePath: {
      type: String,
      required: [true, 'File path is required'],
    },
    fileSize: {
      type: Number,
      required: true, // Size in bytes
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'inactive', 'disabled'],
      default: 'pending',
      index: true,
    },
    downloads: {
      type: Number,
      default: 0,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviews: {
      type: Number,
      default: 0,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    minBalance: {
      type: Number,
      default: 0, // Minimum balance required to use bot
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    parameters: {
      type: Map,
      of: String,
      default: new Map(),
    },
    backtestResults: {
      winRate: Number,
      avgProfit: Number,
      maxDrawdown: Number,
      totalTrades: Number,
      period: String, // e.g., "3 months", "6 months"
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    downloadUrl: {
      type: String,
      default: null,
    },
    checksum: {
      type: String,
      default: null, // For file integrity verification
    },
  },
  {
    timestamps: true,
  }
);

// Index for common queries
botSchema.index({ status: 1, isPublic: 1 });
botSchema.index({ uploadedBy: 1, createdAt: -1 });
botSchema.index({ type: 1, status: 1 });
botSchema.index({ tags: 1 });

// Virtual for download count formatted
botSchema.virtual('formattedDownloads').get(function() {
  if (this.downloads > 1000000) {
    return (this.downloads / 1000000).toFixed(1) + 'M';
  }
  if (this.downloads > 1000) {
    return (this.downloads / 1000).toFixed(1) + 'K';
  }
  return this.downloads.toString();
});

// Method to sanitize bot data for public view
botSchema.methods.toPublic = function() {
  const bot = this.toObject();
  delete bot.filePath;
  delete bot.checksum;
  return bot;
};

// Method to check if user can download
botSchema.methods.canDownload = function(userId) {
  // Owner can always download their own bot
  if (userId.toString() === this.uploadedBy.toString()) {
    return true;
  }
  // Public active bots can be downloaded by anyone
  return this.isPublic && this.status === 'active';
};

const Bot = mongoose.model('Bot', botSchema);

export default Bot;
