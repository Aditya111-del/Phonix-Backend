import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotModel } from '../models/Bot.js';
import { authenticate, adminOnly } from '../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /zip|rar|7z|tar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only archive files are allowed (zip, rar, 7z, tar)'));
    }
  },
});

// Get all bots (admin only)
router.get('/', authenticate, adminOnly, (req, res) => {
  try {
    const bots = BotModel.findAll();
    res.json({ success: true, data: bots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload new bot
router.post('/upload', authenticate, adminOnly, upload.single('file'), (req, res) => {
  try {
    const { name, description, type, version } = req.body;
    const fileName = req.file?.filename;

    if (!name || !description || !type || !fileName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const bot = BotModel.create({
      name,
      description,
      type,
      version: version || '1.0.0',
      fileName,
      uploadedBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Bot uploaded successfully',
      data: bot,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update bot status
router.patch('/:id/status', authenticate, adminOnly, (req, res) => {
  try {
    const { status } = req.body;

    if (!['active', 'pending', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const bot = BotModel.update(req.params.id, { status });

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json({
      success: true,
      message: 'Bot status updated',
      data: bot,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete bot
router.delete('/:id', authenticate, adminOnly, (req, res) => {
  try {
    const success = BotModel.delete(req.params.id);

    if (!success) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json({
      success: true,
      message: 'Bot deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
