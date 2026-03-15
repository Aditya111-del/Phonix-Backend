import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/schemas/User.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixGoogleIdIndex = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix');
    console.log('✓ Connected to MongoDB');

    console.log('\n🔧 Fixing googleId Index...');

    // Get current indexes
    const indexes = await User.collection.getIndexes();
    console.log('\n📋 Current Indexes:');
    Object.entries(indexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, spec);
    });

    // Drop the problematic googleId index if it exists
    try {
      await User.collection.dropIndex('googleId_1');
      console.log('✓ Dropped old googleId_1 index');
    } catch (err) {
      console.log('ℹ googleId_1 index not found (already deleted)');
    }

    // Create new indexes with sparse
    await User.collection.createIndex({ email: 1 }, { unique: true });
    console.log('✓ Created unique index on email');

    await User.collection.createIndex({ googleId: 1 }, { unique: true, sparse: true });
    console.log('✓ Created sparse unique index on googleId');

    // Verify new indexes
    const newIndexes = await User.collection.getIndexes();
    console.log('\n✅ Updated Indexes:');
    Object.entries(newIndexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, spec);
    });

    console.log('\n✅ Database indexes fixed successfully!');
    console.log('   You can now register users without googleId conflicts');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

fixGoogleIdIndex();
