import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotModel } from '../models/Bot.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get all available bots
router.get('/', (req, res) => {
  try {
    const { type, status } = req.query;
    const filters = {};

    if (type) filters.type = type;
    if (status) filters.status = status;

    const bots = BotModel.findAll(filters);
    res.json({ success: true, data: bots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific bot
router.get('/:id', (req, res) => {
  try {
    const bot = BotModel.findById(req.params.id);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json({ success: true, data: bot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download bot (authenticated users only)
router.post('/:id/download', authenticate, (req, res) => {
  try {
    const bot = BotModel.findById(req.params.id);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    console.log('[Bots/Download] Download request:', bot.name, 'by user:', req.user.email);

    // Increment download count
    BotModel.incrementDownloads(req.params.id);

    // Return download link info - frontend will trigger actual download
    const downloadUrl = `/uploads/${bot.fileName}`;
    
    res.json({
      success: true,
      message: 'Download link generated',
      downloadUrl,
      bot: {
        id: bot.id,
        name: bot.name,
        version: bot.version,
        fileName: bot.fileName,
      },
    });
  } catch (error) {
    console.error('[Bots/Download] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
