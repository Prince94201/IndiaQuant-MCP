import { getLivePrice, getSectorSymbols } from '../modules/marketData.js';
import { getOptionsChain, detectUnusualActivity } from '../modules/options.js';
import { calculateGreeks } from '../modules/greeks.js';
import { analyzeSentiment, generateSignal } from '../modules/signals.js';
import { getPortfolioPnL, placeVirtualTrade } from '../modules/portfolio.js';
import { config } from '../config.js';

export const mcpTools = [
    {
        name: "get_live_price",
        description: "Fetch real-time stock quote for NSE/BSE symbols",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Stock symbol (e.g., RELIANCE.NS, TCS.NS)" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "get_options_chain",
        description: "Fetch full CE/PE options chain for given symbol and expiry",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Underlying symbol" },
                expiry: { type: "string", description: "Optional expiry date YYYY-MM-DD" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "analyze_sentiment",
        description: "Analyze news sentiment for a given symbol",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "generate_signal",
        description: "Generate technical and sentiment based trading signal",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                timeframe: { type: "string", enum: ["intraday", "short-term", "medium-term"], default: "short-term" }
            },
            required: ["symbol", "timeframe"]
        }
    },
    {
        name: "get_portfolio_pnl",
        description: "Get virtual portfolio positions and PnL",
        inputSchema: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "place_virtual_trade",
        description: "Place a virtual paper trade",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                quantity: { type: "number" },
                side: { type: "string", enum: ["BUY", "SELL"] }
            },
            required: ["symbol", "quantity", "side"]
        }
    },
    {
        name: "calculate_greeks",
        description: "Calculate Black-Scholes greeks for an option",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" },
                strike: { type: "number" },
                expiry: { type: "string" },
                optionType: { type: "string", enum: ["CE", "PE"] },
                impliedVolatility: { type: "number", description: "Optional IV, else fetched from chain" }
            },
            required: ["symbol", "strike", "expiry", "optionType"]
        }
    },
    {
        name: "detect_unusual_activity",
        description: "Detect unusual options volume or OI activity",
        inputSchema: {
            type: "object",
            properties: {
                symbol: { type: "string" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "scan_market",
        description: "Scan sector for specific signals",
        inputSchema: {
            type: "object",
            properties: {
                sector: { type: "string", enum: ["IT", "BANKING", "ENERGY", "AUTO", "PHARMA", "FMCG"] },
                rsiBelow: { type: "number" },
                rsiAbove: { type: "number" },
                signal: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
                limit: { type: "number", default: 5 }
            },
            required: ["sector"]
        }
    },
    {
        name: "get_sector_heatmap",
        description: "Get performance heatmap of different sectors",
        inputSchema: {
            type: "object",
            properties: {},
            required: []
        }
    }
];

export async function handleToolCall(name: string, args: any): Promise<string> {
    try {
        switch (name) {
            case 'get_live_price': {
                const price = await getLivePrice(args.symbol);
                return JSON.stringify(price, null, 2);
            }
            case 'get_options_chain': {
                const chain = await getOptionsChain(args.symbol, args.expiry);
                return JSON.stringify(chain, null, 2);
            }
            case 'analyze_sentiment': {
                const sentiment = await analyzeSentiment(args.symbol);
                return JSON.stringify(sentiment, null, 2);
            }
            case 'generate_signal': {
                const signal = await generateSignal(args.symbol, args.timeframe);
                return JSON.stringify(signal, null, 2);
            }
            case 'get_portfolio_pnl': {
                const pnl = await getPortfolioPnL();
                return JSON.stringify(pnl, null, 2);
            }
            case 'place_virtual_trade': {
                const trade = await placeVirtualTrade(args.symbol, args.quantity, args.side);
                return JSON.stringify(trade, null, 2);
            }
            case 'calculate_greeks': {
                const { symbol, strike, expiry, optionType, impliedVolatility } = args;
                const oChain = await getOptionsChain(symbol, expiry);
                const underlyingPrice = oChain.underlyingPrice;

                let targetIV = impliedVolatility;
                if (!targetIV) {
                    const contracts = optionType === 'CE' ? oChain.calls : oChain.puts;
                    const match = contracts.find((c: any) => c.strike === strike);
                    targetIV = match && match.impliedVolatility > 0 ? match.impliedVolatility : 0.2;
                }

                const T = (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365.25);

                const greeks = calculateGreeks({
                    S: underlyingPrice,
                    K: strike,
                    T: Math.max(T, 0.001),
                    r: config.riskFreeRate,
                    sigma: targetIV,
                    type: optionType
                });
                return JSON.stringify(greeks, null, 2);
            }
            case 'detect_unusual_activity': {
                const activity = await detectUnusualActivity(args.symbol);
                return JSON.stringify(activity, null, 2);
            }
            case 'scan_market': {
                const symbols = getSectorSymbols(args.sector);
                const results = [];
                let count = 0;
                const limit = args.limit || 5;

                for (const sym of symbols) {
                    if (count >= limit) break;
                    try {
                        const sig = await generateSignal(sym, 'short-term');
                        let match = true;

                        if (args.rsiBelow && sig.rsi && sig.rsi >= args.rsiBelow) match = false;
                        if (args.rsiAbove && sig.rsi && sig.rsi <= args.rsiAbove) match = false;
                        if (args.signal && sig.signal !== args.signal) match = false;

                        if (match) {
                            results.push({ symbol: sym, signal: sig });
                            count++;
                        }
                    } catch (e) {

                    }
                }
                return JSON.stringify({ sector: args.sector, results }, null, 2);
            }
            case 'get_sector_heatmap': {
                const heatmap = [];
                const sectors = ['IT', 'BANKING', 'ENERGY', 'AUTO', 'PHARMA', 'FMCG'];

                for (const sec of sectors) {
                    const syms = getSectorSymbols(sec);
                    let totalChange = 0;
                    let validCount = 0;
                    let topGainer = { symbol: '', change: -Infinity };
                    let topLoser = { symbol: '', change: Infinity };
                    const symbolData = [];

                    for (const s of syms) {
                        try {
                            const live = await getLivePrice(s);
                            totalChange += live.changePercent;
                            validCount++;

                            symbolData.push({ symbol: s, changePercent: live.changePercent });

                            if (live.changePercent > topGainer.change) topGainer = { symbol: s, change: live.changePercent };
                            if (live.changePercent < topLoser.change) topLoser = { symbol: s, change: live.changePercent };
                        } catch (e) { }
                    }

                    if (validCount > 0) {
                        heatmap.push({
                            name: sec,
                            changePercent: totalChange / validCount,
                            topGainer,
                            topLoser,
                            symbols: symbolData
                        });
                    }
                }
                return JSON.stringify({ sectors: heatmap }, null, 2);
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        throw new Error(`Tool execution failed: ${(error as Error).message}`);
    }
}
