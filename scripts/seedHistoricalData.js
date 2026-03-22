import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import { MarketData } from '../models/schemas/MarketData.js';

// Connect to MongoDB
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("No MONGODB_URI found in .env.");
  process.exit(1);
}

const symbolsToSeed = [
  { dbId: '^NSEI', yfId: '^NSEI' },
  { dbId: '^BSESN', yfId: '^BSESN' },
  { dbId: 'SPY', yfId: 'SPY' },
  { dbId: 'QQQ', yfId: 'QQQ' },
  { dbId: 'RELIANCE.BSE', yfId: 'RELIANCE.NS' }
];

async function seedData() {
  try {
    await mongoose.connect(uri);
    console.log('[Seed] Connected to MongoDB.');

    for (const asset of symbolsToSeed) {
      console.log(`[Seed] Fetching 4-month historical EOD data for ${asset.dbId}...`);
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${asset.yfId}?interval=1d&range=4mo`);
      const data = await res.json();
      
      if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
        console.warn(`[Seed] ⚠️ No data returned for ${asset.yfId}`);
        continue;
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];

      if (!timestamps || !quote) {
        console.warn(`[Seed] ⚠️ Malformed data for ${asset.yfId}`);
        continue;
      }

      console.log(`[Seed] Found ${timestamps.length} trading days for ${asset.dbId}. Removing old historical docs...`);
      await MarketData.deleteMany({ symbol: asset.dbId }); // Reset the asset's history to avoid duplicates
      
      const bulkOps = [];
      let prevClose = quote.close[0];

      for (let i = 0; i < timestamps.length; i++) {
        if (!quote.close[i]) continue; // Skip days with null data

        const close = quote.close[i];
        const open = quote.open[i];
        const high = quote.high[i];
        const low = quote.low[i];
        const volume = quote.volume[i] || 0;
        
        let change = 0;
        let changePercent = 0;
        if (i > 0 && prevClose > 0) {
          change = close - prevClose;
          changePercent = (change / prevClose) * 100;
        }

        bulkOps.push({
          insertOne: {
            document: {
               symbol: asset.dbId,
               price: close,
               open,
               high,
               low,
               volume,
               change,
               changePercent,
               source: 'YF_Historical',
               timestamp: new Date(timestamps[i] * 1000)
            }
          }
        });
        prevClose = close;
      }

      if (bulkOps.length > 0) {
        await MarketData.bulkWrite(bulkOps);
        console.log(`[Seed] ✅ Successfully inserted ${bulkOps.length} historical records for ${asset.dbId}`);
      }
    }

    console.log('[Seed] All seeding complete.');
    mongoose.connection.close();
  } catch (error) {
    console.error('[Seed] Fatal Error:', error);
    mongoose.connection.close();
    process.exit(1);
  }
}

seedData();
