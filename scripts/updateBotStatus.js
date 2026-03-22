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

async function updateBotStatus() {
  try {
    await mongoose.connect(ATLAS_MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Find all pending bots
    const pendingBots = await Bot.find({ status: 'pending' });
    console.log(`\n📊 Found ${pendingBots.length} pending bot(s)`);

    // Update all pending bots to active
    if (pendingBots.length > 0) {
      const result = await Bot.updateMany(
        { status: 'pending' },
        { status: 'active' }
      );
      console.log(`✅ Updated ${result.modifiedCount} bot(s) from pending to active`);
      
      // Show updated bots
      const updatedBots = await Bot.find({ status: 'active' });
      console.log(`\n🟢 Active bots now:`);
      updatedBots.forEach((bot) => {
        console.log(`   - ${bot.name} (${bot.type})`);
      });
    } else {
      console.log('No pending bots found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

updateBotStatus();
