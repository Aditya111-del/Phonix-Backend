import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { BotModel } from '../models/Bot.js';
import { authenticate, adminOnly } from '../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'bot-' + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2000 * 1024 * 1024 }, // 2GB limit
  // No file filter - allow any file type
});

// Get all bots (admin only)
router.get('/', authenticate, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const filters = {
      uploadedBy: req.user._id,
    };

    if (status) {
      filters.status = status;
    }

    const result = await BotModel.findAll(filters, { page: parseInt(page), limit: parseInt(limit) });

    res.json(result);
  } catch (error) {
    console.error('[Admin/GetBots] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload new bot
router.post('/upload', authenticate, adminOnly, upload.single('file'), async (req, res) => {
  try {
    console.log('[Admin/Upload] Request received');
    console.log('[Admin/Upload] User:', req.user.email, 'ID:', req.user._id);
    console.log('[Admin/Upload] File:', req.file?.filename, 'Size:', req.file?.size);
    
    const { name, description, type, version, tags, riskLevel, minBalance, backtestResults } = req.body;

    console.log('[Admin/Upload] Form data:', { name, description, type, version });

    // Minimal validation - just check required fields exist
    if (!name || !description || !type || !req.file) {
      console.log('[Admin/Upload] Validation failed - missing fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, description, type, and file',
      });
    }

    console.log('[Admin/Upload] Bot type:', type);

    // Calculate file checksum for integrity
    console.log('[Admin/Upload] Calculating checksum...');
    const fileBuffer = fs.readFileSync(req.file.path);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Parse optional fields (don't validate, just accept as-is)
    let parsedBacktestResults = null;
    if (backtestResults) {
      parsedBacktestResults = backtestResults;
    }

    const botData = {
      name,
      description,
      type,
      version: version || '1.0.0',
      fileName: req.file.filename,
      filePath: req.file.path,
      fileSize: req.file.size,
      uploadedBy: req.user._id,
      status: 'active', // Set to active immediately so it shows up
      tags: tags ? JSON.parse(tags) : [],
      riskLevel: riskLevel || 'medium',
      minBalance: minBalance ? parseInt(minBalance) : 0,
      backtestResults: parsedBacktestResults,
      checksum,
      isPublic: true, // Make public immediately
    };

    console.log('[Admin/Upload] Creating bot with data:', botData);

    const bot = await BotModel.create(botData);

    console.log('[Admin/Upload] Bot created successfully:', bot._id, bot.name);

    res.status(201).json({
      success: true,
      message: 'Bot uploaded successfully',
      data: bot,
    });
  } catch (error) {
    console.error('[Admin/Upload] ERROR:', error);
    console.error('[Admin/Upload] Error stack:', error.stack);
    
    // Clean up uploaded file if there's an error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('[Admin/Upload] Cleaned up file:', req.file.path);
      } catch (cleanupError) {
        console.error('[Admin/Upload] Cleanup error:', cleanupError.message);
      }
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

// Update bot details
router.patch('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const botId = req.params.id;
    const updates = req.body;

    // Only allow admins to update certain fields
    const allowedUpdates = ['name', 'description', 'version', 'tags', 'riskLevel', 'minBalance', 'backtestResults', 'isPublic'];
    const actualUpdates = {};

    for (const field of allowedUpdates) {
      if (field in updates) {
        actualUpdates[field] = updates[field];
      }
    }

    if (Object.keys(actualUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update',
      });
    }

    const bot = await BotModel.update(botId, actualUpdates);

    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    console.log('[Admin/Update] Bot updated:', botId);

    res.json({
      success: true,
      message: 'Bot updated successfully',
      data: bot,
    });
  } catch (error) {
    console.error('[Admin/Update] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update bot status
router.patch('/:id/status', authenticate, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'pending', 'inactive', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const bot = await BotModel.update(req.params.id, { status });

    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    console.log('[Admin/StatusUpdate] Bot status updated:', bot.name, 'to', status);

    res.json({
      success: true,
      message: 'Bot status updated',
      data: bot,
    });
  } catch (error) {
    console.error('[Admin/StatusUpdate] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete bot (soft delete - keep file, mark as deleted)
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const bot = await BotModel.findById(req.params.id);

    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Delete the file
    if (bot.filePath && fs.existsSync(bot.filePath)) {
      try {
        fs.unlinkSync(bot.filePath);
        console.log('[Admin/Delete] File deleted:', bot.filePath);
      } catch (fileError) {
        console.error('[Admin/Delete] Error deleting file:', fileError.message);
      }
    }

    // Delete from database
    await BotModel.delete(req.params.id);

    console.log('[Admin/Delete] Bot deleted:', bot.name);

    res.json({
      success: true,
      message: 'Bot deleted successfully',
    });
  } catch (error) {
    console.error('[Admin/Delete] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
