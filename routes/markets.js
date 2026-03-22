import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { MarketData } from '../models/schemas/MarketData.js';
import { News } from '../models/schemas/News.js';
import ChatSession from '../models/schemas/ChatSession.js';
import { fetchAngelQuote } from '../services/angelOne.js';

const router = express.Router();

const AV_API_KEY = process.env.ALPHA_VANTAGE_KEY || 'demo';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

/**
 * Get quote and news for a stock symbol
 * GET /api/markets/quote/:symbol
 * Uses official Alpha Vantage API with paid tier benefits
 */
router.get('/quote/:symbol', authenticate, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    console.log('[Markets] Fetching comprehensive data for:', symbol);

    // Check cache first (5 minute TTL for paid tier)
    const cached = await MarketData.findOne({ symbol }).sort({ timestamp: -1 });
    
    let marketData = null;
    let news = [];
    let fundamentals = null;

    // Fetch fresh data if cache is old or doesn't exist
    if (!cached || (Date.now() - cached.timestamp.getTime()) > 300000) { // 5 minutes
      console.log('[Markets] Fetching fresh data from Alpha Vantage');
      
      // 1. Fetch Global Quote
      const quoteUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${AV_API_KEY}`;
      const quoteResponse = await fetch(quoteUrl);
      const quoteData = await quoteResponse.json();

      if (!quoteData['Global Quote'] || Object.keys(quoteData['Global Quote']).length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: `Symbol "${symbol}" not found. Please verify the ticker symbol.` 
        });
      }

      const quote = quoteData['Global Quote'];
      
      marketData = {
        symbol,
        price: parseFloat(quote['05. price']),
        open: parseFloat(quote['02. open']),
        high: parseFloat(quote['03. high']),
        low: parseFloat(quote['04. low']),
        volume: parseInt(quote['06. volume']) || 0,
        change: parseFloat(quote['09. change']),
        changePercent: parseFloat(quote['10. change percent']),
        timestamp: new Date()
      };

      // 2. Try to fetch company overview (fundamentals)
      try {
        const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${AV_API_KEY}`;
        const overviewResponse = await fetch(overviewUrl);
        const overviewData = await overviewResponse.json();
        
        if (overviewData['Symbol']) {
          fundamentals = {
            pe: parseFloat(overviewData['PERatio']),
            marketCap: overviewData['MarketCapitalization'],
            dividend: parseFloat(overviewData['DividendPerShare']),
            eps: parseFloat(overviewData['EPS']),
            description: overviewData['Description'],
            sector: overviewData['Sector'],
            industry: overviewData['Industry']
          };
          marketData.fundamentals = fundamentals;
        }
      } catch (err) {
        console.log('[Markets] Could not fetch fundamentals:', err.message);
      }

      // Save to MongoDB
      await MarketData.create(marketData);
      console.log('[Markets] Saved comprehensive data for:', symbol);
    } else {
      marketData = {
        symbol: cached.symbol,
        price: cached.price,
        open: cached.open,
        high: cached.high,
        low: cached.low,
        volume: cached.volume,
        change: cached.change,
        changePercent: cached.changePercent,
        fundamentals: cached.fundamentals,
        timestamp: cached.timestamp
      };
      console.log('[Markets] Using cached data for:', symbol);
    }

    // 3. Fetch news sentiment (enhanced with real data when available)
    news = await News.find({ symbol }).sort({ timestamp: -1 }).limit(10);
    
    // If no cached news, try to fetch from Alpha Vantage or use mock
    if (news.length === 0) {
      try {
        const newsUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=5&apikey=${AV_API_KEY}`;
        const newsResponse = await fetch(newsUrl);
        const newsData = await newsResponse.json();
        
        if (newsData['feed'] && Array.isArray(newsData['feed'])) {
          news = newsData['feed'].slice(0, 5).map((item, idx) => ({
            _id: symbol + '_' + idx,
            headline: item['title'],
            summary: item['summary'],
            source: item['source'],
            timestamp: item['time_published'],
            sentiment: item['overall_sentiment_label'],
            url: item['url']
          }));
          
          // Cache news in MongoDB
          for (const newsItem of news) {
            await News.updateOne(
              { id: newsItem._id },
              { $set: newsItem },
              { upsert: true }
            ).catch(err => console.log('[Markets] News cache error:', err.message));
          }
        } else {
          // Fallback to mock news
          news = generateMockNews(symbol);
        }
      } catch (err) {
        console.log('[Markets] Using mock news:', err.message);
        news = generateMockNews(symbol);
      }
    }

    res.json({
      success: true,
      data: marketData,
      fundamentals: fundamentals,
      news: news.map(n => ({
        id: n._id || n.id,
        headline: n.headline,
        summary: n.summary,
        source: n.source,
        timestamp: n.timestamp,
        sentiment: n.sentiment,
        url: n.url || '#'
      }))
    });

  } catch (error) {
    console.error('[Markets] Error fetching quote:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch market data. Please try again.' 
    });
  }
});

// ── Session Management Routes ─────────────────────────────────────────────

/**
 * List all sessions for the current user
 * GET /api/markets/sessions
 */
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await ChatSession.find({ userId: req.user.id })
      .sort({ updatedAt: -1 })
      .select('_id title lastSymbol createdAt updatedAt messages')
      .lean();
    
    const formatted = sessions.map(s => ({
      id: s._id,
      title: s.title,
      symbol: s.lastSymbol,
      preview: s.messages?.[s.messages.length - 1]?.content?.substring(0, 100) || '',
      messageCount: s.messages?.length || 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.json({ success: true, sessions: formatted });
  } catch (err) {
    console.error('[Sessions] List error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load sessions' });
  }
});

/**
 * Get a single session with full messages
 * GET /api/markets/sessions/:id
 */
router.get('/sessions/:id', authenticate, async (req, res) => {
  try {
    const session = await ChatSession.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    res.json({ success: true, session });
  } catch (err) {
    console.error('[Sessions] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load session' });
  }
});

/**
 * Delete a session
 * DELETE /api/markets/sessions/:id
 */
router.delete('/sessions/:id', authenticate, async (req, res) => {
  try {
    await ChatSession.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('[Sessions] Delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete session' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────


router.post('/analyze', authenticate, async (req, res) => {
  try {
    let { symbol, question, marketData, news, sessionId } = req.body;
    
    if (!question) return res.status(400).json({ error: 'Question is required' });

    console.log('[Markets/Analyze] User:', req.user.id, '| Q:', question, '| Session:', sessionId || 'new');

    // ── 1. Auto-detect symbol ────────────────────────────────────────────────
    const nameTickers = {
      // US Stocks
      apple: 'AAPL', microsoft: 'MSFT', google: 'GOOGL', alphabet: 'GOOGL',
      amazon: 'AMZN', meta: 'META', facebook: 'META', tesla: 'TSLA',
      nvidia: 'NVDA', netflix: 'NFLX', salesforce: 'CRM', shopify: 'SHOP',
      sp500: 'SPY', 'sp 500': 'SPY', nasdaq: 'QQQ', dow: 'DIA',
      
      // Crypto
      bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP',
      dogecoin: 'DOGE', cardano: 'ADA', binance: 'BNB',
      
      // Forex / Commodities
      gold: 'GLD', oil: 'USO', silver: 'SLV',
      'eur/usd': 'EURUSD', 'gbp/usd': 'GBPUSD', 'usd/inr': 'USDINR', 'usd/jpy': 'USDJPY',
      
      // Indian Stocks (NSE/BSE)
      reliance: 'RELIANCE.BSE', tcs: 'TCS.BSE', hdfc: 'HDFCBANK.BSE',
      infosys: 'INFY.BSE', icici: 'ICICIBANK.BSE', sbi: 'SBIN.BSE',
      'bharti airtel': 'BHARTIARTL.BSE', itc: 'ITC.BSE',
      nifty: '^NSEI', sensex: '^BSESN',
      
      // Generic Benchmarks mapped explicitly to live quotes!
      'indian market': '^NSEI', indian: '^NSEI', india: '^NSEI',
      'us market': 'SPY', usa: 'SPY'
    };
    if (!symbol) {
      const lowerQ = question.toLowerCase();
      for (const [name, ticker] of Object.entries(nameTickers)) {
        if (lowerQ.includes(name) && ticker) { symbol = ticker; break; }
      }
      if (!symbol) {
        const tm = question.match(/\b([A-Z]{2,6}(\.[A-Z]{2,4})?)\b/);
        if (tm) symbol = tm[1];
      }
    }

    // ── 2. Load or create session ────────────────────────────────────────────
    let session;
    if (sessionId) {
      session = await ChatSession.findOne({ _id: sessionId, userId: req.user.id });
    }
    if (!session) {
      session = new ChatSession({
        userId: req.user.id,
        title: question.substring(0, 60),
        lastSymbol: symbol || null,
      });
    }
    if (symbol) session.lastSymbol = symbol;

    // ── 3. Auto-fetch real-time market data & news ───────────────────────────
    if (!marketData || !marketData.price || !news || news.length === 0) {
      console.log('[Markets/Analyze] Fetching live context for:', symbol || 'general query');
      try {
        let qPromise = Promise.resolve(null);
        
        if (symbol) {
          const isIndianAsset = symbol.includes('.BSE') || symbol.includes('^NSEI') || symbol.includes('^BSESN');
          if (isIndianAsset) {
            qPromise = fetchAngelQuote(symbol).then(data => data || fetchQuote(symbol)); // Try Angel, fallback AV
          } else {
            qPromise = fetchQuote(symbol);
          }
        }
        
        const searchTarget = symbol ? symbol + " stock" : question.substring(0, 100);
        const [q, n, h] = await Promise.allSettled([
          qPromise, 
          fetchNews(searchTarget),
          symbol ? MarketData.find({ symbol }).sort({ timestamp: -1 }).limit(100).lean() : Promise.resolve([])
        ]);
        
        if (q.status === 'fulfilled' && q.value) marketData = q.value;
        if (n.status === 'fulfilled' && n.value.length > 0) news = n.value;
        if (h.status === 'fulfilled' && h.value && h.value.length > 0) req.marketHistory = h.value;
      } catch (e) {
        console.log('[Markets/Analyze] Data fetch failed:', e.message);
      }
    }

    // ── 4. Build market context ───────────────────────────────────────────────
    let context = '';
    if (symbol && marketData?.price) {
      const dir = marketData.change >= 0 ? '▲' : '▼';
      const pct = Math.abs(marketData.changePercent || 0).toFixed(2);
      const isINR = marketData.source === 'Angel One SmartAPI' || symbol.includes('.BSE') || symbol.includes('^NSEI');
      const cur = isINR ? '₹' : '$';
      context = `
=== LIVE DATA: ${symbol} ===
Price: ${cur}${marketData.price?.toFixed(2)}  |  Change: ${dir}${cur}${Math.abs(marketData.change||0).toFixed(2)} (${dir}${pct}%)
Open: ${cur}${marketData.open?.toFixed(2)}  |  High: ${cur}${marketData.high?.toFixed(2)}  |  Low: ${cur}${marketData.low?.toFixed(2)}
Volume: ${marketData.volume ? (marketData.volume/1e6).toFixed(2)+'M' : 'N/A'}`;
      if (marketData.fundamentals) {
        const f = marketData.fundamentals;
        context += `
Sector: ${f.sector||'N/A'} | P/E: ${f.pe||'N/A'} | EPS: ${cur}${f.eps||'N/A'} | Mkt Cap: ${f.marketCap?cur+(parseInt(f.marketCap)/1e9).toFixed(1)+'B':'N/A'}`;
      }
    }
    if (req.marketHistory && req.marketHistory.length > 0) {
      const history = req.marketHistory;
      
      // Calculate 5-Day Weekly Technicals
      const weekHistory = history.slice(0, 5);
      const wHigh = Math.max(...weekHistory.map(d => d.high || d.price));
      const wLow = Math.min(...weekHistory.map(d => d.low || d.price));
      const wOpen = weekHistory[weekHistory.length - 1]?.open || weekHistory[weekHistory.length - 1]?.price;

      const getPrice = (days) => {
        const doc = history.find(d => (new Date() - new Date(d.timestamp)) >= days*24*60*60*1000);
        return doc ? doc.price : null;
      };
      const p30 = getPrice(30);
      const p60 = getPrice(60);
      const p90 = getPrice(90);

      const isIndianAsset = symbol && (symbol.includes('.BSE') || symbol.includes('^NSEI') || symbol.includes('^BSESN'));
      const formatCur = isIndianAsset ? '₹' : '$';

      if (weekHistory.length > 1) {
        context += `\n\n=== VERIFIED TECHNICAL METRICS (${symbol}) ===`;
        if (marketData?.price) context += `\n- Current Close: ${formatCur}${marketData.price.toFixed(2)}`;
        if (wOpen) context += `\n- Last 5-Day Open: ${formatCur}${wOpen.toFixed(2)}`;
        if (wHigh) context += `\n- Last 5-Day High: ${formatCur}${wHigh.toFixed(2)}`;
        if (wLow) context += `\n- Last 5-Day Low: ${formatCur}${wLow.toFixed(2)}`;
        
        context += `\n\n- RECENT DAILY DATA (Last 10 Trading Days):`;
        history.slice(0, 10).forEach(day => {
          const dateStr = new Date(day.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const clse = day.price ? day.price.toFixed(2) : 'N/A';
          const opn = day.open ? day.open.toFixed(2) : 'N/A';
          const hi = day.high ? day.high.toFixed(2) : 'N/A';
          const lo = day.low ? day.low.toFixed(2) : 'N/A';
          context += `\n  * ${dateStr} - Close: ${formatCur}${clse} | Open: ${formatCur}${opn} | High: ${formatCur}${hi} | Low: ${formatCur}${lo}`;
        });

        if (p30) context += `\n\n- 1 Month Ago: ${formatCur}${p30.toFixed(2)}`;
        if (p60) context += `\n- 2 Months Ago: ${formatCur}${p60.toFixed(2)}`;
        if (p90) context += `\n- 3 Months Ago: ${formatCur}${p90.toFixed(2)}`;
      }
    }

    if (news?.length > 0) {
      context += `\n\n=== LIVE NEWS ===`;
      news.slice(0, 5).forEach((n, i) => {
        const h = n.headline || n.title || '';
        const s = n.sentiment ? ` [${n.sentiment}]` : '';
        let domain = 'News';
        try { if (n.url) domain = new URL(n.url).hostname.replace('www.', ''); } catch(e){}
        context += `\n${i+1}. ${h}${s} (Source: [${domain}](${n.url || ''}))`;
      });
    }
    if (!context) context = 'If no live market data was fetched, you MUST still provide your best analysis, price targets, and signals based on your extensive financial knowledge up to your cutoff date, adapting it to the current market environment.';

    // ── 5. Build conversation history for multi-turn context ─────────────────
    const historyMessages = session.messages.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }));

    // ── 6. System prompt — human-readable PhonixAI ───────────────────────────
    const currentDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
    const isIndianAsset = symbol && (symbol.includes('.BSE') || symbol.includes('^NSEI') || symbol.includes('^BSESN'));
    
    const systemPrompt = `You are PhonixAI, an expert financial analyst and market strategist. 

CRITICAL INFORMATION:
- The current date and time is: ${currentDate} (IST - Indian Standard Time).
- NEVER say you don't know the current date. You are operating in real-time.
- If the current time is outside Indian Market Hours (Mon-Fri, 9:15 AM to 3:30 PM IST), the "Current Close" is the PREVIOUS SESSION'S CLOSING PRICE. Do NOT hallucinate that a move is happening "today intraday" if it's the weekend or 1:00 AM on a Monday. 
- You analyze US Stocks, Indian Stocks (NSE/BSE), Crypto markets, and Forex pairs comprehensively.

Your job is to give crisp, human-readable trading analysis. Use plain English — no LaTeX, no raw math formulas.

For every stock/crypto/forex question, structure your response exactly like this:

## Signal & Confidence
Start with one of: 🟢 STRONG BUY / 🟡 BUY / ⚪ HOLD / 🔴 SELL / ⛔ STRONG SELL — then state your confidence (e.g. 82% confident).

## Price Targets — 30-Day Outlook
Use a simple Markdown table:
| Scenario | Target | Move |
|----------|--------|------|
| 🎯 Bull | $XXX | +X% |
| 📍 Base | $XXX | +X% |
| ⚠️ Stop-Loss | $XXX | -X% |
Then state the risk-reward ratio in plain English (e.g. "Risk-reward is 2:1 — you risk $15 to make $30"). (Adjust currency to ₹ INR for Indian stocks, or standard base currencies for Forex).

## Key Levels
Provide the exact Support and Resistance levels as bullet points (NOT a table), including the reason:
- **Support:** ${isIndianAsset ? '₹' : '$'}XXX (Reason: ...)
- **Resistance:** ${isIndianAsset ? '₹' : '$'}YYY (Reason: ...)

## News & Sentiment
Briefly summarize current market sentiment: Bullish / Neutral / Bearish and why in 1-2 sentences.

## Trader's Thesis
One clear paragraph: why this trade makes sense right now, what catalysts to watch, and what would invalidate this call. Provide real predictions and detailed technical/fundamental reasons.

RULES:
- Be direct and decisive. Never hedge excessively.
- CRITICAL: DO NOT HALLUCINATE NUMBERS. If macro data (like FII/DII flows, specific auto sales, exact percentages) is NOT explicitly mentioned in the Live News context, DO NOT invent it. Instead, rely on broader logical inferences.
- DO NOT add inline source citations. The backend will automatically append a list of sources to the bottom of your response.
- Follow the EXACT Verified Technical Metrics provided to you when referencing past highs/lows. Do not guess the history.
- Use the live market data provided if available. If none is provided, still give concrete price targets and a signal based on historical ranges and your internal data models up to ${currentDate}.
- If user is asking a follow-up question, use the conversation history for context.
- Keep your response scannable — use headers and bullets. ONLY use a table for the 30-Day Outlook.
- Never output LaTeX or raw math. Write numbers in plain English.`;

    // ── 7. Call AI ────────────────────────────────────────────────────────────
    const aiMessages = [
      { role: 'system', content: systemPrompt + (context ? `\n\nCurrent Market Context:\n${context}` : '') },
      ...historyMessages,
      { role: 'user', content: question },
    ];

    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://phonix.app',
        'X-Title': 'PhonixAI Trading Assistant',
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        messages: aiMessages,
        temperature: 0.65,
        max_tokens: 1500,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[Markets/Analyze] LLM error:', llmResponse.status, errText);
      throw new Error(`AI service error: ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    let analysis = llmData.choices?.[0]?.message?.content || 'No analysis generated.';

    // ── Natively Append Sources to Bottom ────────────────────────────────────
    if (news && news.length > 0) {
      let sourcesHtml = '\n\n';
      news.slice(0, 5).forEach((n) => {
        let domain = 'News';
        try { if (n.url) domain = new URL(n.url).hostname.replace('www.', ''); } catch(e){}
        if (n.url) sourcesHtml += `[${domain}](${n.url}) `;
      });
      analysis += sourcesHtml;
    }

    // ── 8. Save messages to session ──────────────────────────────────────────
    session.messages.push({ role: 'user', content: question, symbol: symbol || null });
    session.messages.push({ role: 'assistant', content: analysis, symbol: symbol || null, marketData: marketData || null });
    if (session.messages.length > 100) session.messages = session.messages.slice(-100);
    await session.save();

    console.log('[Markets/Analyze] Done. Session:', session._id, '| Symbol:', symbol || 'general');

    res.json({
      success: true,
      analysis,
      symbol: symbol || null,
      sessionId: session._id,
      marketData: marketData || null,
    });

  } catch (error) {
    console.error('[Markets/Analyze] Error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Analysis failed. Please try again.' });
  }
});



/**
 * COMPREHENSIVE MARKET INTELLIGENCE ENDPOINT
 * POST /api/markets/deep-analysis
 * Combines: Real-time prices + Historical trends + News sentiment + Technical analysis + AI interpretation
 */
router.post('/deep-analysis', authenticate, async (req, res) => {
  try {
    const { symbol } = req.body;
    
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    const targetSymbol = symbol.toUpperCase();
    console.log('[Markets/DeepAnalysis] Starting comprehensive analysis for:', targetSymbol);
    
    // Fetch all data in parallel
    const [
      quoteResponse,
      overviewResponse,
      newsResponse,
      technicalResponse,
      historyResponse
    ] = await Promise.allSettled([
      fetchQuote(targetSymbol),
      fetchOverview(targetSymbol),
      fetchNews(targetSymbol),
      fetchTechnical(targetSymbol),
      MarketData.find({ symbol: targetSymbol }).sort({ timestamp: -1 }).limit(30)
    ]);

    // Extract results
    const quote = quoteResponse.status === 'fulfilled' ? quoteResponse.value : null;
    const overview = overviewResponse.status === 'fulfilled' ? overviewResponse.value : null;
    const news = newsResponse.status === 'fulfilled' ? newsResponse.value : [];
    const technical = technicalResponse.status === 'fulfilled' ? technicalResponse.value : null;
    const history = historyResponse.status === 'fulfilled' ? historyResponse.value : [];

    if (!quote) {
      return res.status(404).json({ error: `Could not fetch data for ${targetSymbol}` });
    }

    // Calculate metrics
    const metrics = calculateMetrics(quote, history, news);
    
    // Build comprehensive context for AI
    const aiContext = buildComprehensiveContext(targetSymbol, quote, overview, news, technical, metrics);

    // Call OpenRouter AI with reasoning
    const systemPrompt = `You are an expert financial analyst and market strategist. 
Your role is to provide comprehensive market intelligence that combines:
1. Real-time price action and volume analysis
2. Historical trend patterns and volatility
3. News sentiment and catalyst analysis
4. Technical indicator signals
5. Fundamental valuation metrics

Provide clear, actionable insights. Format with sections.
cite specific numbers. Highlight key turning points and risk factors.
Do NOT give buy/sell recommendations but DO provide probability assessments and risk/reward analysis.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'stepfun/step-3.5-flash:free',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Provide comprehensive market analysis for the following asset:\n\n${aiContext}`
          }
        ],
        reasoning: { enabled: true },
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const aiData = await response.json();
    const analysis = aiData.choices[0]?.message?.content || '';

    // Save analysis to database
    await MarketData.findOneAndUpdate(
      { symbol: targetSymbol },
      { 
        aiAnalysis: analysis,
        lastAnalyzed: new Date()
      },
      { upsert: true }
    );

    res.json({
      success: true,
      symbol: targetSymbol,
      quote,
      overview,
      metrics,
      analysis,
      newsCount: news.length,
      dataPoints: {
        recentPrices: history.length,
        newsArticles: news.length,
        technicalIndicators: technical ? Object.keys(technical).length : 0
      }
    });

  } catch (error) {
    console.error('[Markets/DeepAnalysis] Error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Deep analysis failed' 
    });
  }
});

/**
 * Get historical data for a symbol
 * GET /api/markets/history/:symbol
 */
router.get('/history/:symbol', authenticate, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const days = parseInt(req.query.days) || 30;

    const history = await MarketData.find({
      symbol,
      timestamp: {
        $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      }
    }).sort({ timestamp: -1 });

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('[Markets/History] Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch history' 
    });
  }
});

/**
 * Get technical indicators for a symbol
 * GET /api/markets/technical/:symbol?indicator=RSI
 */
router.get('/technical/:symbol', authenticate, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const indicator = (req.query.indicator || 'RSI').toUpperCase();
    
    console.log('[Markets/Technical] Fetching', indicator, 'for:', symbol);

    const indicatorParams = {
      'RSI': { time_period: 14, series_type: 'close' },
      'MACD': { series_type: 'close' },
      'BBANDS': { time_period: 5, series_type: 'close', nbdevup: 2, nbdevdn: 2 },
      'STOCH': { fastkperiod: 5, slowkperiod: 3, slowdperiod: 3, series_type: 'close' },
      'ADX': { time_period: 14 },
      'ATR': { time_period: 14 }
    };

    const params = indicatorParams[indicator] || {};
    const url = `https://www.alphavantage.co/query?function=${indicator}&symbol=${symbol}&interval=daily&apikey=${AV_API_KEY}&${new URLSearchParams(params).toString()}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data['Error Message']) {
      return res.status(404).json({ 
        success: false, 
        error: 'Failed to fetch technical indicator' 
      });
    }

    const timeSeriesKey = Object.keys(data).find(key => key.includes('Technical Analysis'));
    const timeSeries = data[timeSeriesKey] || {};
    
    // Get latest 20 values
    const latestValues = Object.entries(timeSeries)
      .slice(0, 20)
      .map(([date, values]) => ({
        date,
        ...values
      }));

    res.json({
      success: true,
      indicator,
      symbol,
      data: latestValues
    });

  } catch (error) {
    console.error('[Markets/Technical] Error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch technical indicators' 
    });
  }
});

/**
 * Get news sentiment for a symbol
 * GET /api/markets/sentiment/:symbol
 */
router.get('/sentiment/:symbol', authenticate, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = parseInt(req.query.limit) || 10;
    
    console.log('[Markets/Sentiment] Fetching sentiment for:', symbol);

    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=${limit}&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data['feed']) {
      const news = data['feed'].map((item, idx) => ({
        id: symbol + '_' + idx,
        title: item['title'],
        summary: item['summary'],
        source: item['source'],
        sentiment: item['overall_sentiment_label'],
        sentimentScore: parseFloat(item['overall_sentiment_score']),
        relevance: parseFloat(item['relevance_score']),
        url: item['url'],
        timePublished: item['time_published']
      }));

      res.json({
        success: true,
        symbol,
        news
      });
    } else {
      res.json({
        success: true,
        symbol,
        news: []
      });
    }

  } catch (error) {
    console.error('[Markets/Sentiment] Error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch sentiment data' 
    });
  }
});

/**
 * Get top gainers/losers
 * GET /api/markets/gainers
 */
router.get('/gainers', authenticate, async (req, res) => {
  try {
    console.log('[Markets/Gainers] Fetching top gainers');

    const url = `https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data['top_gainers']) {
      res.json({
        success: true,
        gainers: data['top_gainers'],
        losers: data['top_losers'],
        mostActive: data['most_actively_traded']
      });
    } else {
      res.json({
        success: true,
        gainers: [],
        losers: [],
        mostActive: []
      });
    }

  } catch (error) {
    console.error('[Markets/Gainers] Error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch gainers/losers' 
    });
  }
});

/**
 * Get intraday data for a symbol
 * GET /api/markets/intraday/:symbol?interval=5min
 */
router.get('/intraday/:symbol', authenticate, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const interval = req.query.interval || '5min';
    
    console.log('[Markets/Intraday] Fetching intraday for:', symbol, 'interval:', interval);

    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=${interval}&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    const timeSeriesKey = Object.keys(data).find(key => key.includes('Time Series'));
    const timeSeries = data[timeSeriesKey] || {};
    
    if (Object.keys(timeSeries).length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No intraday data available'
      });
    }

    const latestData = Object.entries(timeSeries)
      .slice(0, 100)
      .map(([time, values]) => ({
        time,
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        volume: parseInt(values['5. volume'])
      }));

    res.json({
      success: true,
      symbol,
      interval,
      data: latestData
    });

  } catch (error) {
    console.error('[Markets/Intraday] Error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch intraday data' 
    });
  }
});

/**
 * Helper: Build market context for Claude
 */
function buildMarketContext(symbol, marketData, news) {
  if (!marketData) {
    return `No market data available for ${symbol}.`;
  }

  let context = `# Market Data for ${symbol}

## Price Action
- Current Price: $${marketData.price.toFixed(2)}
- Day Change: ${marketData.change >= 0 ? '+' : ''}${marketData.change.toFixed(2)} (${marketData.changePercent >= 0 ? '+' : ''}${marketData.changePercent.toFixed(2)}%)
- Open: $${marketData.open.toFixed(2)}
- High: $${marketData.high.toFixed(2)}
- Low: $${marketData.low.toFixed(2)}
- Volume: ${(marketData.volume / 1000000).toFixed(1)}M shares
`;

  if (news && news.length > 0) {
    context += `\n## Recent News\n`;
    news.slice(0, 5).forEach(item => {
      context += `- **${item.headline}** (${item.source})\n`;
      if (item.summary) {
        context += `  ${item.summary}\n`;
      }
    });
  }

  return context;
}

/**
 * Helper: Generate mock news (for demo)
 */
function generateMockNews(symbol) {
  const mockNews = [
    {
      _id: 'news-1',
      headline: `${symbol} Reports Strong Q4 Earnings`,
      summary: `${symbol} exceeded analyst expectations with robust financial performance in Q4.`,
      source: 'Financial Times',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      url: '#'
    },
    {
      _id: 'news-2',
      headline: `Analysts Raise Price Target for ${symbol}`,
      summary: `Multiple analysts have raised their price targets following recent earnings.`,
      source: 'Bloomberg',
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
      url: '#'
    },
    {
      _id: 'news-3',
      headline: `${symbol} Announces New Product Launch`,
      summary: `The company unveils innovative new product expected to drive growth.`,
      source: 'Reuters',
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
      url: '#'
    },
    {
      _id: 'news-4',
      headline: `Market Rally Boosts ${symbol} Stock`,
      summary: `${symbol} gains as positive sentiment spreads across the technology sector.`,
      source: 'MarketWatch',
      timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000),
      url: '#'
    },
    {
      _id: 'news-5',
      headline: `Industry Report: ${symbol} Maintains Market Lead`,
      summary: `Fresh industry research confirms ${symbol}'s competitive advantage.`,
      source: 'Fortune',
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
      url: '#'
    }
  ];

  return mockNews;
}

/**
 * Helper: Fetch quote data
 */
async function fetchQuote(symbol) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${AV_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (!data['Global Quote'] || Object.keys(data['Global Quote']).length === 0) {
    throw new Error(`Symbol ${symbol} not found`);
  }

  const quote = data['Global Quote'];
  return {
    symbol,
    price: parseFloat(quote['05. price']),
    open: parseFloat(quote['02. open']),
    high: parseFloat(quote['03. high']),
    low: parseFloat(quote['04. low']),
    volume: parseInt(quote['06. volume']) || 0,
    change: parseFloat(quote['09. change']),
    changePercent: parseFloat(quote['10. change percent']),
    timestamp: new Date(quote['07. latest trading day'])
  };
}

/**
 * Helper: Fetch company overview (fundamentals)
 */
async function fetchOverview(symbol) {
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data['Symbol']) {
      return null;
    }

    return {
      symbol: data['Symbol'],
      name: data['Name'],
      sector: data['Sector'],
      industry: data['Industry'],
      marketCap: parseInt(data['MarketCapitalization']) || 0,
      pe: parseFloat(data['PERatio']) || null,
      eps: parseFloat(data['EPS']) || null,
      dividend: parseFloat(data['DividendPerShare']) || 0,
      description: data['Description'] || '',
      exchange: data['Exchange'],
      country: data['Country'],
      currency: data['Currency']
    };
  } catch (err) {
    console.log('[Markets] Overview fetch failed:', err.message);
    return null;
  }
}

/**
 * Helper: Fetch news and sentiment
 */
async function fetchNews(query) {
  try {
    // Try Tavily AI Search first for much more accurate global/Indian market news
    if (process.env.TAVILY_API_KEY) {
      const tavilyUrl = 'https://api.tavily.com/search';
      const searchResponse = await fetch(tavilyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: `${query} financial market news latest updates analysis`,
          search_depth: 'basic',
          include_images: false,
          include_answer: false,
          topic: 'news',
          days: 3,
          max_results: 5
        })
      });
      const tavilyData = await searchResponse.json();
      
      if (tavilyData && tavilyData.results && tavilyData.results.length > 0) {
        return tavilyData.results.map((item, idx) => {
          let hostname = 'news';
          try { hostname = new URL(item.url).hostname.replace('www.', ''); } catch(e){}
          return {
            id: 'news_' + idx + '_' + Math.random().toString(36).substr(2, 5),
            title: item.title,
            summary: item.content,  // Tavily returns highly summarized snippet 'content'
            source: hostname,
            sentiment: 'NEUTRAL', // Tavily gives deep snippets, the LLM will determine sentiment
            sentimentScore: 0,
            relevance: item.score || 0.9,
            url: item.url,
            timePublished: item.published_date || new Date().toISOString()
          };
        });
      }
    }

    // Fallback to Alpha Vantage if Tavily fails or doesn't have data (only works well for strict symbols)
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${query.split(' ')[0]}&limit=5&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data['feed'] || !Array.isArray(data['feed'])) {
      return [];
    }

    return data['feed'].map((item, idx) => ({
      id: 'av_news_' + idx,
      title: item['title'],
      summary: item['summary'],
      source: item['source'],
      sentiment: item['overall_sentiment_label'],
      sentimentScore: parseFloat(item['overall_sentiment_score']) || 0,
      relevance: parseFloat(item['relevance_score']) || 0,
      url: item['url'],
      timePublished: item['time_published']
    }));
  } catch (err) {
    console.log('[Markets] News fetch failed:', err.message);
    return [];
  }
}

/**
 * Helper: Fetch technical indicators
 */
async function fetchTechnical(symbol) {
  try {
    const indicators = {};
    
    // Fetch RSI
    const rsiUrl = `https://www.alphavantage.co/query?function=RSI&symbol=${symbol}&interval=daily&time_period=14&series_type=close&apikey=${AV_API_KEY}`;
    const rsiResponse = await fetch(rsiUrl);
    const rsiData = await rsiResponse.json();
    const rsiKey = Object.keys(rsiData).find(k => k.includes('Technical Analysis'));
    if (rsiKey) {
      const latest = Object.entries(rsiData[rsiKey])[0];
      if (latest) {
        indicators.rsi = parseFloat(latest[1]['RSI']);
      }
    }

    return indicators;
  } catch (err) {
    console.log('[Markets] Technical fetch failed:', err.message);
    return {};
  }
}

/**
 * Helper: Calculate key metrics
 */
function calculateMetrics(quote, history, news) {
  const metrics = {
    currentPrice: quote.price,
    dayChange: quote.change,
    dayChangePercent: quote.changePercent,
    dayVolume: quote.volume,
    high52Week: quote.high,
    low52Week: quote.low,
    volatility: null,
    priceRange: null,
    sentiment: 'neutral',
    newsCount: news.length,
    positiveNews: 0,
    negativeNews: 0,
    neutralNews: 0,
    trendDirection: 'neutral'
  };

  // Calculate sentiment
  if (news.length > 0) {
    metrics.positiveNews = news.filter(n => n.sentiment === 'POSITIVE').length;
    metrics.negativeNews = news.filter(n => n.sentiment === 'NEGATIVE').length;
    metrics.neutralNews = news.filter(n => n.sentiment === 'NEUTRAL').length;

    if (metrics.positiveNews > metrics.negativeNews) {
      metrics.sentiment = 'BULLISH';
    } else if (metrics.negativeNews > metrics.positiveNews) {
      metrics.sentiment = 'BEARISH';
    } else {
      metrics.sentiment = 'NEUTRAL';
    }
  }

  // Calculate volatility from history
  if (history.length > 1) {
    const changes = [];
    for (let i = 0; i < history.length - 1; i++) {
      const change = ((history[i].price - history[i + 1].price) / history[i + 1].price) * 100;
      changes.push(change);
    }
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / changes.length;
    metrics.volatility = Math.sqrt(variance);
    metrics.priceRange = (quote.high - quote.low) / quote.low * 100;
  }

  // Determine trend
  if (history.length > 1) {
    const currentPrice = history[0]?.price || quote.price;
    const pastPrice = history[Math.min(5, history.length - 1)]?.price || quote.open;
    
    if (currentPrice > pastPrice * 1.02) {
      metrics.trendDirection = 'UPTREND';
    } else if (currentPrice < pastPrice * 0.98) {
      metrics.trendDirection = 'DOWNTREND';
    }
  }

  return metrics;
}

/**
 * Helper: Build comprehensive context for AI analysis
 */
function buildComprehensiveContext(symbol, quote, overview, news, technical, metrics) {
  let context = `# COMPREHENSIVE MARKET INTELLIGENCE REPORT\n\n`;
  context += `## Asset: ${symbol}\n`;

  if (overview) {
    context += `**Company:** ${overview.name}\n`;
    context += `**Sector:** ${overview.sector} | **Industry:** ${overview.industry}\n`;
    context += `**Country:** ${overview.country} | **Exchange:** ${overview.exchange}\n\n`;
  }

  context += `## PRICE ACTION (Real-Time)\n`;
  context += `- Current Price: $${quote.price.toFixed(2)}\n`;
  context += `- Day Change: ${quote.change >= 0 ? '+' : ''}$${quote.change.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)\n`;
  context += `- Open/High/Low: $${quote.open.toFixed(2)} / $${quote.high.toFixed(2)} / $${quote.low.toFixed(2)}\n`;
  context += `- Volume: ${(quote.volume / 1000000).toFixed(1)}M shares\n\n`;

  context += `## FUNDAMENTALS\n`;
  if (overview) {
    if (overview.pe) context += `- P/E Ratio: ${overview.pe.toFixed(2)}\n`;
    if (overview.eps) context += `- EPS: $${overview.eps.toFixed(2)}\n`;
    if (overview.marketCap) context += `- Market Cap: $${(overview.marketCap / 1000000000).toFixed(2)}B\n`;
    if (overview.dividend) context += `- Dividend: $${overview.dividend.toFixed(4)}\n`;
  } else {
    context += `- Data not available\n`;
  }
  context += `\n`;

  context += `## TECHNICAL ANALYSIS\n`;
  context += `- Trend Direction: ${metrics.trendDirection}\n`;
  if (metrics.volatility != null) {
    context += `- Volatility (std dev): ${metrics.volatility.toFixed(2)}%\n`;
    context += `- Price Range (day): ${metrics.priceRange?.toFixed(2)}%\n`;
  }
  if (technical && technical.rsi) {
    context += `- RSI (14): ${technical.rsi.toFixed(1)} (${technical.rsi > 70 ? 'OVERBOUGHT' : technical.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL'})\n`;
  }
  context += `\n`;

  context += `## NEWS SENTIMENT ANALYSIS\n`;
  context += `- Recent News Count: ${metrics.newsCount}\n`;
  context += `- Sentiment: ${metrics.sentiment}\n`;
  context += `- Positive: ${metrics.positiveNews} | Neutral: ${metrics.neutralNews} | Negative: ${metrics.negativeNews}\n`;
  
  if (news.length > 0) {
    context += `\n### Top Headlines:\n`;
    news.slice(0, 5).forEach(article => {
      context += `- **${article.title}** [${article.sentiment}]\n`;
      context += `  Source: ${article.source} | Relevance: ${(article.relevance * 100).toFixed(0)}%\n`;
    });
  }
  context += `\n`;

  context += `## ANALYSIS CONTEXT\n`;
  context += `Report generated: ${new Date().toISOString()}\n`;
  context += `All data is current and represents real market conditions.\n`;

  return context;
}

export default router;

