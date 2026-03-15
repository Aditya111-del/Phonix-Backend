import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/schemas/User.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const completeReset = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix');
    console.log('✓ Connected to MongoDB');

    console.log('\n⚠️  COMPLETE DATABASE RESET');
    console.log('================================');

    // Drop the entire users collection
    try {
      await User.collection.drop();
      console.log('✓ Dropped users collection');
    } catch (err) {
      if (err.message.includes('ns not found')) {
        console.log('ℹ Users collection did not exist');
      } else {
        throw err;
      }
    }

    // Recreate the collection with proper indexes
    console.log('\n🔧 Creating fresh collection...');
    
    // Create a new document to initialize the collection
    const newUser = new User({
      name: 'Test User',
      email: 'test-init@example.com',
      password: 'temp123456',
      role: 'user'
    });

    // Save to create collection
    await newUser.save();
    console.log('✓ Collection created with initial user');

    // Now remove the test user
    await User.deleteOne({ email: 'test-init@example.com' });
    console.log('✓ Test user removed');

    // Verify final indexes
    const indexes = await User.collection.getIndexes();
    console.log('\n✅ Final Indexes:');
    Object.entries(indexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, spec);
    });

    console.log('\n✅ Database successfully reset!');
    console.log('   Collection is now empty and ready for new registrations');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

completeReset();
