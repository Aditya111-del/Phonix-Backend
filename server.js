import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './db/connection.js';

// IMPORTANT: Load environment variables FIRST before anything else
dotenv.config({ path: path.resolve(new URL('.', import.meta.url).pathname, '.env') });

// Import routes
import authRoutes from './routes/auth.js';
import botsRoutes from './routes/bots.js';
import adminRoutes from './routes/admin.js';
import marketsRoutes from './routes/markets.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Log environment setup
console.log('[Server] Starting Phonix Backend Server');
console.log('[Server] JWT_SECRET configured:', process.env.JWT_SECRET ? '✓ yes' : '✗ no (using default)');
console.log('[Server] MongoDB URI configured:', process.env.MONGODB_URI ? '✓ yes' : '✗ no');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to MongoDB
connectDB().catch((error) => {
  console.error('Failed to connect to MongoDB:', error.message);
  process.exit(1);
});

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:5173',
    'https://phonix-two.vercel.app',
    process.env.FRONTEND_URL || 'http://localhost:5173'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bots', botsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/markets', marketsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date() });
});

// Debug endpoint to show JWT_SECRET (DELETE IN PRODUCTION!)
app.get('/api/debug/jwt-secret', (req, res) => {
  const secret = process.env.JWT_SECRET || 'your-secret-key';
  res.json({ 
    jwt_secret: secret,
    jwt_secret_preview: secret.substring(0, 20) + '...',
    env_loaded: !!process.env.JWT_SECRET
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
