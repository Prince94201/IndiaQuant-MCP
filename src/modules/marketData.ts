import yahooFinance from 'yahoo-finance2';
import { cache } from '../utils/cache.js';
import { formatSymbol } from '../utils/symbolFormatter.js';
import axios from 'axios';
import { config } from '../config.js';

const NIFTY_50_SYMBOLS = [
    'ADANIENT.NS', 'ADANIPORTS.NS', 'APOLLOHOSP.NS', 'ASIANPAINT.NS', 'AXISBANK.NS',
    'BAJAJ-AUTO.NS', 'BAJFINANCE.NS', 'BAJAJFINSV.NS', 'BPCL.NS', 'BHARTIARTL.NS',
    'BRITANNIA.NS', 'CIPLA.NS', 'COALINDIA.NS', 'DIVISLAB.NS', 'DRREDDY.NS',
    'EICHERMOT.NS', 'GRASIM.NS', 'HCLTECH.NS', 'HDFCBANK.NS', 'HDFCLIFE.NS',
    'HEROMOTOCO.NS', 'HINDALCO.NS', 'HINDUNILVR.NS', 'ICICIBANK.NS', 'ITC.NS',
    'INDUSINDBK.NS', 'INFY.NS', 'JSWSTEEL.NS', 'KOTAKBANK.NS', 'LTIM.NS',
    'LT.NS', 'M&M.NS', 'MARUTI.NS', 'NTPC.NS', 'NESTLEIND.NS',
    'ONGC.NS', 'POWERGRID.NS', 'RELIANCE.NS', 'SBILIFE.NS', 'SBIN.NS',
    'SUNPHARMA.NS', 'TCS.NS', 'TATACONSUM.NS', 'TATAMOTORS.NS', 'TATASTEEL.NS',
    'TECHM.NS', 'TITAN.NS', 'UPL.NS', 'ULTRACEMCO.NS', 'WIPRO.NS'
];

interface LivePrice {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    timestamp: string;
}

export async function getLivePrice(symbol: string): Promise<LivePrice> {
    const formattedSymbol = formatSymbol(symbol);
    const cacheKey = `price_${formattedSymbol}`;
    const cached = cache.get<LivePrice>(cacheKey);

    if (cached) return cached;

    try {
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${formattedSymbol.replace('.NS', '.BSE')}&apikey=${config.alphaVantageKey}`;
        const response = await axios.get(url);
        
        if (response.data && response.data['Global Quote'] && response.data['Global Quote']['05. price']) {
            const quote = response.data['Global Quote'];
            const result: LivePrice = {
                symbol: formattedSymbol,
                price: parseFloat(quote['05. price']),
                change: parseFloat(quote['09. change']),
                changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
                volume: parseInt(quote['06. volume'], 10),
                timestamp: new Date().toISOString()
            };
            cache.set(cacheKey, result, 60); // 60s TTL
            return result;
        }

        throw new Error("Invalid response from AlphaVantage");
    } catch (alphaError) {
        try {
            // @ts-ignore
            const quote = await yahooFinance.quote(formattedSymbol as string);
            const result: LivePrice = {
                symbol: formattedSymbol,
                price: quote.regularMarketPrice || 0,
                change: quote.regularMarketChange || 0,
                changePercent: quote.regularMarketChangePercent || 0,
                volume: quote.regularMarketVolume || 0,
                timestamp: new Date().toISOString()
            };
            cache.set(cacheKey, result, 60); // 60s TTL
            return result;
        } catch (yahooError) {
            throw new Error(`Failed to fetch live price for ${formattedSymbol}: AlphaVantage and YahooFinance both failed. Yahoo Error: ${(yahooError as Error).message}`);
        }
    }
}

export async function getHistoricalOHLC(symbol: string, period: string, interval: string) {
    const formattedSymbol = formatSymbol(symbol);
    const cacheKey = `ohlc_${formattedSymbol}_${period}_${interval}`;
    const cached = cache.get<any>(cacheKey);

    if (cached) return cached;

    try {
        const periodMap: Record<string, string> = {
            '1d': '1d', '5d': '5d', '1mo': '1mo', '3mo': '3mo', '6mo': '6mo', '1y': '1y'
        };
        const validPeriod = periodMap[period] || '1mo';

        const now = new Date();
        let period1 = new Date();

        if (period === '1d') period1.setDate(now.getDate() - 1);
        else if (period === '5d') period1.setDate(now.getDate() - 5);
        else if (period === '1mo') period1.setMonth(now.getMonth() - 1);
        else if (period === '3mo') period1.setMonth(now.getMonth() - 3);
        else if (period === '6mo') period1.setMonth(now.getMonth() - 6);
        else if (period === '1y') period1.setFullYear(now.getFullYear() - 1);
        else period1.setMonth(now.getMonth() - 1);

        try {
            // @ts-ignore
            const chart = await yahooFinance.historical(formattedSymbol, {
                period1: period1,
                interval: interval as any
            });

            const quotes = chart.filter((q: any) => q.close !== null);
            cache.set(cacheKey, quotes, 300); // 300s TTL
            return quotes;
        } catch (yahooError) {
            console.warn(`Yahoo Finance failed for historical data. Falling back to AlphaVantage for ${formattedSymbol}`);
            
            // AlphaVantage mapping (Forcing daily since intraday is premium)
            let functionName = 'TIME_SERIES_DAILY';
            const cleanInterval = interval.toLowerCase();
            
            if (cleanInterval.includes('wk') || cleanInterval.includes('w')) {
                functionName = 'TIME_SERIES_WEEKLY';
            } else if (cleanInterval.includes('mo')) {
                functionName = 'TIME_SERIES_MONTHLY';
            }

            let avUrl = `https://www.alphavantage.co/query?function=${functionName}&symbol=${formattedSymbol.replace('.NS', '.BSE')}&apikey=${config.alphaVantageKey}`;

            const response = await axios.get(avUrl);
            const dataKey = Object.keys(response.data || {}).find(key => key.startsWith('Time Series'));
            
            if (!response.data || !dataKey) {
                 throw new Error(`Invalid response from AlphaVantage historical API. Details: ${JSON.stringify(response.data)}`);
            }

            const series = response.data[dataKey];
            const quotes = Object.entries(series).map(([dateStr, values]: [string, any]) => ({
                date: new Date(dateStr),
                open: parseFloat(values['1. open']),
                high: parseFloat(values['2. high']),
                low: parseFloat(values['3. low']),
                close: parseFloat(values['4. close']),
                volume: parseFloat(values['5. volume']),
            })).sort((a, b) => a.date.getTime() - b.date.getTime()); // Chronological

            // Filter out events older than period1
            const filteredQuotes = quotes.filter(q => q.date >= period1);

            cache.set(cacheKey, filteredQuotes, 300);
            return filteredQuotes;
        }
    } catch (error) {
        throw new Error(`Failed to fetch OHLC for ${formattedSymbol}: ${(error as Error).message}`);
    }
}

export function getNifty50Symbols(): string[] {
    return NIFTY_50_SYMBOLS;
}

export function getSectorSymbols(sector: string): string[] {
    const sectors: Record<string, string[]> = {
        'IT': ['TCS.NS', 'INFY.NS', 'WIPRO.NS', 'HCLTECH.NS', 'TECHM.NS', 'LTIM.NS'],
        'BANKING': ['HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'AXISBANK.NS', 'KOTAKBANK.NS', 'INDUSINDBK.NS'],
        'ENERGY': ['RELIANCE.NS', 'ONGC.NS', 'NTPC.NS', 'POWERGRID.NS', 'BPCL.NS'],
        'AUTO': ['TATAMOTORS.NS', 'MARUTI.NS', 'M&M.NS', 'BAJAJ-AUTO.NS', 'EICHERMOT.NS', 'HEROMOTOCO.NS'],
        'PHARMA': ['SUNPHARMA.NS', 'DRREDDY.NS', 'CIPLA.NS', 'DIVISLAB.NS'],
        'FMCG': ['ITC.NS', 'HINDUNILVR.NS', 'BRITANNIA.NS', 'NESTLEIND.NS', 'TATACONSUM.NS']
    };

    const formattedSector = sector.toUpperCase();
    return sectors[formattedSector] || [];
}
