import { TOTP } from 'totp-generator';
import dotenv from 'dotenv';
dotenv.config();

const {
  ANGEL_API_KEY,
  ANGEL_SECRET_KEY,
  ANGEL_CLIENT_ID,
  ANGEL_PIN,
  ANGEL_TOTP_SECRET,
} = process.env;

let cachedJwtToken = null;
let cachedFeedToken = null;
let tokenExpiry = 0;

// Hardcoded prominent NSE tokens for instant lookup (avoids 100MB download)
const NSE_TOKENS = {
  'RELIANCE.BSE': '2885',
  'TCS.BSE': '11536',
  'HDFCBANK.BSE': '1333',
  'INFY.BSE': '1594',
  'ICICIBANK.BSE': '4963',
  'SBIN.BSE': '3045',
  'BHARTIARTL.BSE': '10604',
  'ITC.BSE': '1660',
  '^NSEI': '26000', // NIFTY 50
  '^BSESN': '999901' // SENSEX (BSE) - Note: Angel uses different tokens for indices, usually "26000" for Nifty
};

/**
 * Authenticate with Angel One to get the JWT token.
 * Cache it for 12 hours (Angel tokens expire daily).
 */
async function authenticateAngel() {
  if (cachedJwtToken && Date.now() < tokenExpiry) {
    return cachedJwtToken;
  }

  if (!ANGEL_API_KEY || !ANGEL_CLIENT_ID || !ANGEL_PIN || !ANGEL_TOTP_SECRET) {
    console.warn('[AngelOne] Missing credentials in .env');
    return null;
  }

  const generatedRes = await TOTP.generate(ANGEL_TOTP_SECRET);
  const generatedTotp = generatedRes.otp;

  try {
    const res = await fetch('https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '106.193.147.98',
        'X-MACAddress': '00-11-22-33-44-55',
        'X-PrivateKey': ANGEL_API_KEY,
      },
      body: JSON.stringify({
        clientcode: ANGEL_CLIENT_ID,
        password: ANGEL_PIN,
        totp: generatedTotp,
      }),
    });

    const data = await res.json();
    
    if (data.status && data.data?.jwtToken) {
      cachedJwtToken = data.data.jwtToken;
      cachedFeedToken = data.data.feedToken;
      tokenExpiry = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
      console.log('[AngelOne] Successfully authenticated.');
      return cachedJwtToken;
    } else {
      console.error('[AngelOne] Auth failed:', data.message || data);
      return null;
    }
  } catch (error) {
    console.error('[AngelOne] Auth error:', error.message);
    return null;
  }
}

/**
 * Fetch a real-time quote for an NSE symbol using Angel One.
 */
export async function fetchAngelQuote(symbol) {
  const token = await authenticateAngel();
  if (!token) return null;

  const angelToken = NSE_TOKENS[symbol];
  if (!angelToken) {
    console.log(`[AngelOne] No hardcoded token for ${symbol}. Skipping Angel One.`);
    return null; // Fallback to AlphaVantage or AI knowledge
  }

  // Determine exchange (Indices typically need distinct exchanges in Angel, but we'll default to NSE)
  const exchange = symbol === '^BSESN' ? 'BSE' : 'NSE';

  try {
    const res = await fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '106.193.147.98',
        'X-MACAddress': '00-11-22-33-44-55',
        'X-PrivateKey': ANGEL_API_KEY,
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        mode: 'FULL',
        exchangeTokens: {
          [exchange]: [angelToken]
        }
      })
    });

    const data = await res.json();
    
    if (data.status && data.data?.fetched?.[0]) {
      const q = data.data.fetched[0];
      return {
        price: parseFloat(q.ltp),
        open: parseFloat(q.open),
        high: parseFloat(q.high),
        low: parseFloat(q.low),
        close: parseFloat(q.close),
        volume: parseInt(q.volume || q.vtt || 0),
        change: parseFloat(q.ltp) - parseFloat(q.close),
        changePercent: ((parseFloat(q.ltp) - parseFloat(q.close)) / parseFloat(q.close)) * 100,
        source: 'Angel One SmartAPI'
      };
    } else {
      console.warn(`[AngelOne] Quote fetch failed for ${symbol}:`, data.message);
      return null;
    }
  } catch (error) {
    console.error(`[AngelOne] Quote error for ${symbol}:`, error.message);
    return null;
  }
}
