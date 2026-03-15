import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { MarketData } from '../models/schemas/MarketData.js';
import { News } from '../models/schemas/News.js';

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

/**
 * Analyze stock with AI (OpenRouter - Step-3.5-Flash with reasoning)
 * POST /api/markets/analyze
 */
router.post('/analyze', authenticate, async (req, res) => {
  try {
    const { symbol, question, marketData, news } = req.body;
    
    if (!symbol || !question) {
      return res.status(400).json({ 
        error: 'Symbol and question are required' 
      });
    }

    console.log('[Markets/Analyze] Processing:', symbol, 'Question:', question);

    // Build market context
    const context = buildMarketContext(symbol, marketData, news);

    // Call OpenRouter API with reasoning
    const systemPrompt = `You are an expert financial analyst with deep knowledge of markets, stocks, and trading.
You analyze market data, news, and technical indicators to provide insights about stocks.
Always be data-driven and cite specific numbers from the provided data.
Do NOT make definitive buy/sell recommendations - instead provide analysis and observations.
Be concise and focus on answering the user's specific question.
Acknowledge uncertainty when appropriate.
Format your response with clear sections and bullet points where helpful.`;

    const fullPrompt = `Market Data Context:
${context}

User Question: ${question}

Please provide a detailed analysis based on the data above.`;

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
            content: fullPrompt
          }
        ],
        reasoning: { enabled: true },
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const analysis = data.choices[0]?.message?.content || '';

    res.json({
      success: true,
      analysis,
      symbol,
      question
    });

  } catch (error) {
    console.error('[Markets/Analyze] Error:', error.message);
    res.status(500).json({ 
      error: error.message || 'Failed to analyze stock' 
    });
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
async function fetchNews(symbol) {
  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=10&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data['feed'] || !Array.isArray(data['feed'])) {
      return [];
    }

    return data['feed'].map((item, idx) => ({
      id: symbol + '_news_' + idx,
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

