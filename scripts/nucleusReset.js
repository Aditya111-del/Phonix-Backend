import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nucleusReset = async () => {
  try {
    console.log('🔧 Connecting to MongoDB...');
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix');
    console.log('✓ Connected to MongoDB');

    const db = conn.connection.db;

    // Step 1: Drop entire collection
    console.log('\n📋 Dropping users collection...');
    try {
      await db.dropCollection('users');
      console.log('✓ users collection dropped');
    } catch (err) {
      if (!err.message.includes('ns not found')) {
        throw err;
      }
      console.log('ℹ  users collection did not exist');
    }

    // Step 2: Drop all indexes
    console.log('\n📋 Dropping all indexes...');
    try {
      await db.collection('users').dropIndexes();
      console.log('✓ All indexes dropped');
    } catch (err) {
      console.log('ℹ  No indexes to drop');
    }

    // Step 3: Import User model fresh
    console.log('\n📋 Importing User model...');
    const { default: User } = await import('../models/schemas/User.js');
    
    // Step 4: Create indexes from schema
    console.log('\n🔧 Creating indexes from schema...');
    await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true });
    console.log('✓ Created unique sparse index on email');

    await User.collection.createIndex({ googleId: 1 }, { unique: true, sparse: true });
    console.log('✓ Created unique sparse index on googleId');

    // Step 5: Verify indexes
    console.log('\n✅ Final Indexes:');
    const indexes = await User.collection.getIndexes();
    Object.entries(indexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, JSON.stringify(spec));
    });

    console.log('\n✅ Database completely reset and ready!');
    console.log('   You can now register new users');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
};

nucleusReset();
