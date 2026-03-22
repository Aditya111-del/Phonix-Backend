import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { BotModel } from '../models/Bot.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get all available bots with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 12, type, search, sort = 'downloads' } = req.query;

    console.log('[Bots/List] Request received:', { page, limit, type, search, sort });

    const filters = {
      status: 'active',
      isPublic: true,
    };

    if (type) {
      filters.type = type;
    }

    if (search) {
      filters.search = search;
    }

    const result = await BotModel.findAll(filters, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    console.log('[Bots/List] Result from BotModel:', {
      success: result.success,
      dataCount: result.data?.length || 0,
      pagination: result.pagination,
    });

    // Apply sorting
    let bots = result.data || [];
    switch (sort) {
      case 'newest':
        bots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'rating':
        bots.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case 'downloads':
      default:
        bots.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
        break;
    }

    // Sanitize bot data for public view
    const publicBots = bots.map(bot => {
      if (typeof bot.toPublic === 'function') {
        return bot.toPublic();
      }
      // Remove sensitive fields manually
      const botObj = bot.toObject ? bot.toObject() : bot;
      delete botObj.filePath;
      delete botObj.checksum;
      return botObj;
    });

    console.log('[Bots/List] Returning', publicBots.length, 'public bots');

    res.json({
      success: true,
      data: publicBots,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[Bots/List] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific bot details
router.get('/:id', async (req, res) => {
  try {
    const bot = await BotModel.findById(req.params.id);

    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    if (!bot.isPublic && (!req.user || req.user._id.toString() !== bot.uploadedBy.toString())) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const publicBot = bot.toPublic ? bot.toPublic() : bot;

    res.json({
      success: true,
      data: publicBot,
    });
  } catch (error) {
    console.error('[Bots/GetById] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download bot with file streaming (authenticated users only)
router.post('/:id/download', authenticate, async (req, res) => {
  try {
    const bot = await BotModel.findById(req.params.id);

    if (!bot) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Check permissions
    if (!bot.canDownload(req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot download bot - inactive or access denied',
      });
    }

    // Check if file exists
    if (!fs.existsSync(bot.filePath)) {
      return res.status(500).json({
        success: false,
        error: 'Bot file not found on server',
      });
    }

    console.log('[Bots/Download] Download started:', bot.name, 'by user:', req.user.email);

    // Increment download count asynchronously
    BotModel.incrementDownloads(req.params.id).catch(err => {
      console.error('[Bots/Download] Error incrementing downloads:', err.message);
    });

    // Set response headers for file download
    const fileName = bot.fileName;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', bot.fileSize);
    res.setHeader('X-File-Checksum', bot.checksum); // Send checksum for verification

    // Stream the file
    const fileStream = fs.createReadStream(bot.filePath);

    fileStream.on('error', (error) => {
      console.error('[Bots/Download] Stream error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Error reading file' });
      }
    });

    fileStream.pipe(res);

    // Log download completion
    fileStream.on('end', () => {
      console.log('[Bots/Download] Download completed:', bot.name);
    });
  } catch (error) {
    console.error('[Bots/Download] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify file checksum after download (for integrity check)
router.post('/:id/verify', authenticate, (req, res) => {
  try {
    const { checksum } = req.body;

    if (!checksum) {
      return res.status(400).json({
        success: false,
        error: 'Checksum is required for verification',
      });
    }

    // In a real scenario, you'd want to fetch the bot and verify
    // For now, we just acknowledge the request
    res.json({
      success: true,
      message: 'Checksum verification request received',
    });
  } catch (error) {
    console.error('[Bots/Verify] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get bot types (categories)
router.get('/types/list', (req, res) => {
  try {
    const types = ['scalping', 'swing', 'day-trading', 'position', 'arbitrage', 'other'];
    res.json({
      success: true,
      data: types,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search bots
router.get('/search/query', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Search query is required' });
    }

    const bots = await BotModel.search(q, parseInt(limit));
    const publicBots = bots.map(bot => bot.toPublic ? bot.toPublic() : bot);

    res.json({
      success: true,
      data: publicBots,
    });
  } catch (error) {
    console.error('[Bots/Search] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
