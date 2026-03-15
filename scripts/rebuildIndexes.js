import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/schemas/User.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rebuildIndexes = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix');
    console.log('✓ Connected to MongoDB');

    console.log('\n🔧 Rebuilding Database Indexes...');

    // Drop and recreate indexes
    await User.collection.dropIndexes();
    console.log('✓ Dropped existing indexes');

    // Create new indexes
    await User.collection.createIndex({ email: 1 }, { unique: true });
    console.log('✓ Created unique index on email field');

    // Verify indexes
    const indexes = await User.collection.getIndexes();
    console.log('\n📋 Current Indexes:');
    Object.entries(indexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, spec);
    });

    console.log('\n✅ Database indexes rebuilt successfully');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

rebuildIndexes();
