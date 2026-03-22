import cron from 'node-cron';
import { MarketData } from '../models/schemas/MarketData.js';
import { fetchAngelQuote } from './angelOne.js';

export function initCronJobs() {
  console.log('[Cron] Initializing auto-sync market jobs...');
  
  // Run every 4 hours on Monday through Friday
  cron.schedule('0 */4 * * 1-5', async () => {
    console.log('[Cron] Running scheduled market data sync (Executing every 4 hours)...');
    
    // Core global indices to track for deep macro context
    const symbolsToTrack = ['^NSEI', 'SPY', '^BSESN', 'QQQ', 'RELIANCE.BSE'];

    for (const symbol of symbolsToTrack) {
      try {
        let priceData = null;
        
        // 1. Try Angel One for Indian assets
        if (symbol === '^NSEI' || symbol === '^BSESN' || symbol.includes('.BSE')) {
           priceData = await fetchAngelQuote(symbol);
        }
        
        // 2. Try Alpha Vantage for US assets or fallback
        if (!priceData && process.env.ALPHA_VANTAGE_KEY) {
           const avSymbol = symbol.replace('.BSE', ':BSE'); // AV format for Bombay Exchange
           const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSymbol}&apikey=${process.env.ALPHA_VANTAGE_KEY}`);
           const data = await res.json();
           const quote = data['Global Quote'];
           
           if (quote && quote['05. price']) {
             priceData = {
               price: parseFloat(quote['05. price']),
               open: parseFloat(quote['02. open']),
               high: parseFloat(quote['03. high']),
               low: parseFloat(quote['04. low']),
               volume: parseInt(quote['06. volume']),
               change: parseFloat(quote['09. change']),
               changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
               source: 'Alpha Vantage'
             };
           }
        }

        // 3. Save directly to DB as historical EOD entry
        if (priceData && priceData.price) {
          const doc = new MarketData({
            symbol,
            ...priceData,
            timestamp: new Date()
          });
          await doc.save();
          console.log(`[Cron] Successfully synced and archived live data for ${symbol}: ${priceData.price}`);
        } else {
          console.log(`[Cron] Could not fetch live data to archive for ${symbol}`);
        }
      } catch (err) {
        console.error(`[Cron] Error fetching archive data for ${symbol}:`, err.message);
      }
      
      // Delay slightly between requests to respect API rate limits (AV free tier limit)
      await new Promise(r => setTimeout(r, 2000));
    }
  });
}
