/**
 * Phonix - Admin Seed Script
 * Creates the initial admin user if one does not already exist.
 * Run: node scripts/seed.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix';

// Inline user schema (avoid circular imports)
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const ADMIN_EMAIL = 'admin@phonix.com';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_NAME = 'Admin User';

async function seed() {
  console.log('[Seed] Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('[Seed] Connected.');

  const existing = await User.findOne({ email: ADMIN_EMAIL });

  if (existing) {
    console.log(`[Seed] Admin user "${ADMIN_EMAIL}" already exists. Skipping.`);
  } else {
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(ADMIN_PASSWORD, salt);

    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: 'admin',
      isActive: true,
    });

    console.log(`[Seed] ✅ Admin user created:`);
    console.log(`       Email:    ${ADMIN_EMAIL}`);
    console.log(`       Password: ${ADMIN_PASSWORD}`);
  }

  await mongoose.disconnect();
  console.log('[Seed] Done.');
}

seed().catch((err) => {
  console.error('[Seed] Error:', err.message);
  process.exit(1);
});
