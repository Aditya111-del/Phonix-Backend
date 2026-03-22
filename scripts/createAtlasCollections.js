import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/schemas/User.js';
import { MarketData } from '../models/schemas/MarketData.js';

// Load .env from backend root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath });

const ATLAS_MONGODB_URI = process.env.MONGODB_URI;

if (!ATLAS_MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

console.log('🔄 Creating collections on Atlas...');
console.log(`☁️  Atlas: ${ATLAS_MONGODB_URI.replace(/:[^:]*@/, ':****@')}`);

async function createCollections() {
  try {
    // Connect to Atlas
    await mongoose.connect(ATLAS_MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to Atlas MongoDB');

    // Create collections by using the models
    // This will create the collections if they don't exist
    
    // Create users collection with sample data
    console.log('\n📦 Creating users collection...');
    const sampleUser = new User({
      name: 'Sample User',
      email: `sample-${Date.now()}@example.com`,
      password: 'password123',
      role: 'user',
      isActive: true
    });
    await sampleUser.save();
    console.log('✅ Users collection created with sample user');

    // Create marketdata collection with sample data
    console.log('\n📦 Creating marketdatas collection...');
    const sampleMarketData = new MarketData({
      symbol: 'AAPL',
      price: 150.25,
      open: 149.50,
      high: 152.00,
      low: 148.00,
      volume: 1000000,
      change: 0.75,
      changePercent: 0.50,
      pe: 25.5,
      marketCap: '2.5T'
    });
    await sampleMarketData.save();
    console.log('✅ MarketDatas collection created with sample data');

    // Create news collection (if schema exists)
    console.log('\n📦 Creating news collection...');
    const newsCollection = mongoose.connection.collection('news');
    await newsCollection.insertOne({
      title: 'Sample News',
      content: 'This is sample news',
      source: 'sample',
      timestamp: new Date()
    });
    console.log('✅ News collection created');

    console.log('\n✅ All collections created successfully on Atlas!');
    console.log('\n📊 Created collections:');
    console.log('   1. users');
    console.log('   2. marketdatas');
    console.log('   3. news');

  } catch (error) {
    console.error('❌ Error creating collections:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

createCollections();
