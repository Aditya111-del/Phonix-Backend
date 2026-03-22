import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Bot from '../models/schemas/Bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath });

const ATLAS_MONGODB_URI = process.env.MONGODB_URI;

if (!ATLAS_MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

async function checkBots() {
  try {
    await mongoose.connect(ATLAS_MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Get all bots
    const allBots = await Bot.find().populate('uploadedBy', 'name email');
    console.log(`\n📊 Total bots in database: ${allBots.length}\n`);

    if (allBots.length === 0) {
      console.log('No bots found in database');
    } else {
      allBots.forEach((bot, i) => {
        console.log(`${i + 1}. ${bot.name}`);
        console.log(`   Type: ${bot.type}`);
        console.log(`   Status: ${bot.status}`);
        console.log(`   Public: ${bot.isPublic}`);
        console.log(`   Downloads: ${bot.downloads}`);
        console.log(`   Uploaded by: ${bot.uploadedBy?.email || 'Unknown'}`);
        console.log(`   File: ${bot.fileName}`);
        console.log('');
      });
    }

    // Check active and public bots (what shows up in the marketplace)
    const activeBots = await Bot.find({ status: 'active', isPublic: true });
    console.log(`\n🟢 Active and Public bots: ${activeBots.length}`);
    activeBots.forEach((bot) => {
      console.log(`   - ${bot.name}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkBots();
