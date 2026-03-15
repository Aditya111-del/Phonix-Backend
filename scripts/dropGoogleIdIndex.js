import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const dropGoogleIdIndex = async () => {
  try {
    console.log('🔧 Connecting to MongoDB...');
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonix');
    console.log('✓ Connected to MongoDB');

    const db = conn.connection.db;
    const collection = db.collection('users');

    console.log('\n📋 Current indexes:');
    try {
      const indexList = await collection.listIndexes().toArray();
      indexList.forEach((index) => {
        console.log(`  - ${index.name}:`, index.key);
      });

      console.log('\n🔥 Dropping googleId_1 index...');
      await collection.dropIndex('googleId_1');
      console.log('✓ Dropped googleId_1 index');
    } catch (err) {
      if (err.message.includes('index not found')) {
        console.log('ℹ googleId_1 index not found (may have been removed already)');
      } else {
        throw err;
      }
    }

    console.log('\n✅ Remaining indexes:');
    const finalIndexList = await collection.listIndexes().toArray();
    finalIndexList.forEach((index) => {
      console.log(`  - ${index.name}:`, index.key);
    });

    console.log('\n✅ Done! You can now test signup');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

dropGoogleIdIndex();
