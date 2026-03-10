import { RSI, MACD, BollingerBands } from 'technicalindicators';
import axios from 'axios';
import { getHistoricalOHLC } from './marketData.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import { config } from '../config.js';
import { getCompanyName } from '../utils/symbolFormatter.js';
import { cache } from '../utils/cache.js';

export function computeRSI(closes: number[], period = 14) {
    if (closes.length < period) return null;
    const rsiValues = RSI.calculate({ values: closes, period });
    const latestRSI = rsiValues[rsiValues.length - 1];
    return {
        value: latestRSI,
        isOversold: latestRSI < 30,
        isOverbought: latestRSI > 70
    };
}

export function computeMACD(closes: number[]) {
    if (closes.length < 26) return null;
    const macdValues = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    });
    const latest = macdValues[macdValues.length - 1];
    const prev = macdValues[macdValues.length - 2];

    let crossover = 'NONE';
    if (latest && prev && prev.MACD !== undefined && prev.signal !== undefined && latest.MACD !== undefined && latest.signal !== undefined) {
        if (prev.MACD <= prev.signal && latest.MACD > latest.signal) crossover = 'BULLISH';
        else if (prev.MACD >= prev.signal && latest.MACD < latest.signal) crossover = 'BEARISH';
    }

    return {
        macdLine: latest?.MACD,
        signalLine: latest?.signal,
        histogram: latest?.histogram,
        crossover
    };
}

export function computeBollingerBands(closes: number[], period = 20) {
    if (closes.length < period) return null;
    const bbValues = BollingerBands.calculate({ values: closes, period, stdDev: 2 });
    const latest = bbValues[bbValues.length - 1];

    const squeeze = latest && latest.middle ? (latest.upper - latest.lower) / latest.middle < 0.05 : false;

    return {
        upper: latest?.upper,
        middle: latest?.middle,
        lower: latest?.lower,
        isSqueeze: squeeze
    };
}

export async function analyzeSentiment(symbol: string) {
    const cacheKey = `sentiment_${symbol}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return cached;

    const companyName = getCompanyName(symbol);
    let headlines: string[] = [];

    if (config.newsApiKey && rateLimiter.checkLimit('NewsAPI', 100)) {
        try {
            const response = await axios.get('https://newsapi.org/v2/everything', {
                params: {
                    q: companyName,
                    sortBy: 'publishedAt',
                    language: 'en',
                    pageSize: 10,
                    apiKey: config.newsApiKey
                }
            });
            headlines = response.data.articles.map((a: any) => a.title).filter(Boolean);
        } catch (error) {
            console.error(`NewsAPI error for ${symbol}:`, (error as Error).message);
        }
    }

    if (headlines.length === 0 && config.alphaVantageKey && rateLimiter.checkLimit('AlphaVantage', 25)) {
        try {
            const response = await axios.get('https://www.alphavantage.co/query', {
                params: {
                    function: 'NEWS_SENTIMENT',
                    tickers: symbol.replace('.NS', ''),
                    limit: 10,
                    apikey: config.alphaVantageKey
                }
            });
            if (response.data.feed) {
                headlines = response.data.feed.map((f: any) => f.title);
            }
        } catch (error) {
            console.error(`AlphaVantage error for ${symbol}:`, (error as Error).message);
        }
    }

    const positiveWords = ['growth', 'profit', 'soar', 'surge', 'jump', 'up', 'high', 'win', 'beat', 'bull', 'upgrade'];
    const negativeWords = ['loss', 'drop', 'fall', 'plunge', 'down', 'low', 'miss', 'bear', 'downgrade', 'lawsuit', 'scandal'];

    let totalScore = 0;
    for (const hl of headlines) {
        const lowerHl = hl.toLowerCase();
        for (const pw of positiveWords) {
            if (lowerHl.includes(pw)) totalScore += 1;
        }
        for (const nw of negativeWords) {
            if (lowerHl.includes(nw)) totalScore -= 1;
        }
    }

    const maxPossibleScore = Math.max(headlines.length, 1) * 2;
    let normalizedScore = totalScore / maxPossibleScore;
    normalizedScore = Math.max(-1, Math.min(1, normalizedScore));

    let signal = 'NEUTRAL';
    if (normalizedScore > 0.2) signal = 'BULLISH';
    if (normalizedScore < -0.2) signal = 'BEARISH';

    const result = {
        score: normalizedScore,
        signal,
        headlines
    };

    cache.set(cacheKey, result, 3600);
    return result;
}

export async function generateSignal(symbol: string, timeframe: string) {
    let period = '6mo';
    let interval = '1d';
    
    // Using 1d everywhere for now because AlphaVantage Free Tier blocks intraday data
    // Fetching 3mo minimum so AV returns >26 candles for MACD calculation
    if (timeframe === 'intraday') {
        period = '3mo'; 
        interval = '1d';
    } else if (timeframe === 'short-term') {
        period = '3mo';
        interval = '1d';
    }

    const ohlc = await getHistoricalOHLC(symbol, period, interval);
    const closes = ohlc.map((c: any) => c.close).filter((c: number) => c !== null && c !== undefined);

    if (closes.length < 26) {
        throw new Error(`Not enough historical data to generate signal for ${symbol}`);
    }

    const rsi = computeRSI(closes);
    const macd = computeMACD(closes);
    const bb = computeBollingerBands(closes);
    const sentiment = await analyzeSentiment(symbol);

    let techScore = 0;
    let reasoning: string[] = [];

    if (rsi && rsi.isOversold) {
        techScore += 33;
        reasoning.push('RSI indicates oversold conditions (Buy signal).');
    } else if (rsi && rsi.isOverbought) {
        techScore -= 33;
        reasoning.push('RSI indicates overbought conditions (Sell signal).');
    } else if (rsi) {
        if (rsi.value > 50) techScore += 16;
        else techScore -= 16;
        reasoning.push(`RSI is neutral at ${rsi.value.toFixed(2)}.`);
    }

    if (macd && macd.crossover === 'BULLISH') {
        techScore += 33;
        reasoning.push('MACD shows bullish crossover.');
    } else if (macd && macd.crossover === 'BEARISH') {
        techScore -= 33;
        reasoning.push('MACD shows bearish crossover.');
    } else if (macd && macd.macdLine !== undefined && macd.signalLine !== undefined) {
        if (macd.macdLine > macd.signalLine) techScore += 16;
        else techScore -= 16;
    }

    const lastClose = closes[closes.length - 1];
    if (bb && bb.lower !== undefined && lastClose < bb.lower) {
        techScore += 34;
        reasoning.push('Price is below lower Bollinger Band (Buy signal).');
    } else if (bb && bb.upper !== undefined && lastClose > bb.upper) {
        techScore -= 34;
        reasoning.push('Price is above upper Bollinger Band (Sell signal).');
    } else if (bb && bb.isSqueeze) {
        reasoning.push('Bollinger Bands indicate a volatility squeeze.');
    }

    let normalizedTech = (techScore + 100) / 2;
    let normalizedSent = (sentiment.score + 1) * 50;

    const finalConfidence = (normalizedTech * 0.6) + (normalizedSent * 0.4);

    let finalSignal = 'HOLD';
    if (finalConfidence > 65) finalSignal = 'BUY';
    else if (finalConfidence < 35) finalSignal = 'SELL';

    reasoning.push(`Sentiment analysis yielded a ${sentiment.signal} signal with ${sentiment.headlines.length} related headlines analyzed.`);

    return {
        signal: finalSignal,
        confidence: finalConfidence,
        reasoning: reasoning.join(' '),
        rsi: rsi?.value,
        macd,
        bollinger: bb,
        sentiment
    };
}
