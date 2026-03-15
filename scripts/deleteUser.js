import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/schemas/User.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const deleteUser = async () => {
  try {
    const email = process.argv[2];

    if (!email) {
      console.error('❌ Please provide an email address');
      console.log('Usage: node deleteUser.js <email>');
      process.exit(1);
    }

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix');
    console.log('✓ Connected to MongoDB');

    // Find and delete user
    const result = await User.deleteOne({ email: email.toLowerCase() });

    if (result.deletedCount === 0) {
      console.log(`ℹ User with email "${email}" not found`);
      process.exit(0);
    }

    console.log(`✅ User "${email}" has been deleted`);
    console.log(`   You can now register this email again`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

deleteUser();
