import yahooFinance from 'yahoo-finance2';
import { formatSymbol } from '../utils/symbolFormatter.js';
import { getLivePrice } from './marketData.js';

export interface OptionContract {
    strike: number;
    lastPrice: number;
    bid: number;
    ask: number;
    volume: number;
    openInterest: number;
    impliedVolatility: number;
}

export interface OptionsChain {
    expiry: string;
    calls: OptionContract[];
    puts: OptionContract[];
    underlyingPrice: number;
}

function mapContract(c: any): OptionContract {
    return {
        strike: c.strike,
        lastPrice: c.lastPrice,
        bid: c.bid || 0,
        ask: c.ask || 0,
        volume: c.volume || 0,
        openInterest: c.openInterest || 0,
        impliedVolatility: c.impliedVolatility || 0
    };
}

export async function getOptionsChain(symbol: string, expiry?: string): Promise<OptionsChain> {
    const formattedSymbol = formatSymbol(symbol);

    try {
        let queryOpts: any = {};
        if (expiry) {
            queryOpts.date = new Date(expiry);
        }

        // @ts-ignore
        const result = await yahooFinance.options(formattedSymbol, queryOpts);

        if (!result || !result.options || result.options.length === 0) {
            throw new Error('No options data found for this symbol/expiry.');
        }

        const targetOptionSet = result.options[0];
        const underlyingPrice = result.quote.regularMarketPrice || 0;

        const expDate = targetOptionSet.expirationDate;
        const expiryStr = expDate instanceof Date ? expDate.toISOString() : new Date(Number(expDate) > 10000000000 ? expDate : Number(expDate) * 1000).toISOString();

        return {
            expiry: expiryStr,
            calls: (targetOptionSet.calls || []).map(mapContract),
            puts: (targetOptionSet.puts || []).map(mapContract),
            underlyingPrice
        };

    } catch (error) {
        throw new Error(`Failed to fetch options chain for ${formattedSymbol}: ${(error as Error).message}. Note: Indian indices natively rate-limit or fail on Yahoo Finance.`);
    }
}

export async function calculateMaxPain(symbol: string, expiry?: string) {
    const chain = await getOptionsChain(symbol, expiry);

    const strikes = new Set<number>();
    chain.calls.forEach(c => strikes.add(c.strike));
    chain.puts.forEach(p => strikes.add(p.strike));

    const sortedStrikes = Array.from(strikes).sort((a, b) => a - b);

    let minPain = Infinity;
    let maxPainStrike = 0;

    for (const testStrike of sortedStrikes) {
        let totalPain = 0;

        for (const c of chain.calls) {
            if (testStrike > c.strike) {
                totalPain += (testStrike - c.strike) * c.openInterest;
            }
        }

        for (const p of chain.puts) {
            if (testStrike < p.strike) {
                totalPain += (p.strike - testStrike) * p.openInterest;
            }
        }

        if (totalPain < minPain) {
            minPain = totalPain;
            maxPainStrike = testStrike;
        }
    }

    return {
        maxPainStrike,
        explanation: `Option sellers experience minimum dollar loss automatically if the underlying settles at ${maxPainStrike}.`
    };
}

export async function detectUnusualActivity(symbol: string) {
    const chain = await getOptionsChain(symbol);

    let alerts: string[] = [];
    let anomalies: any[] = [];

    const allContracts = [
        ...chain.calls.map(c => ({ ...c, type: 'Call' })),
        ...chain.puts.map(p => ({ ...p, type: 'Put' }))
    ];

    let totalVol = 0;
    let nonZeroVolCount = 0;
    for (const c of allContracts) {
        if (c.volume > 0) {
            totalVol += c.volume;
            nonZeroVolCount++;
        }
    }
    const avgVolume = nonZeroVolCount > 0 ? totalVol / nonZeroVolCount : 0;

    for (const c of allContracts) {
        if (c.volume > 0 && c.openInterest > 0) {
            if (c.volume > avgVolume * 2 && c.volume > 100) {
                anomalies.push({ ...c, reason: 'High Volume (2x Avg)' });
                alerts.push(`Unusual volume: ${c.type} Strike ${c.strike} (Vol: ${c.volume}, Avg: ${avgVolume.toFixed(0)})`);
            } else if (c.volume / c.openInterest > 0.5 && c.volume > 100) {
                anomalies.push({ ...c, reason: 'High Volume/OI Ratio (>0.5)' });
                alerts.push(`Volume exceeds 50% of OI: ${c.type} Strike ${c.strike} (Vol: ${c.volume}, OI: ${c.openInterest})`);
            }
        }
    }

    return {
        alerts,
        anomalies,
        summary: `Found ${anomalies.length} unusual options activities.`
    };
}

export async function getExpiryDates(symbol: string): Promise<string[]> {
    const formattedSymbol = formatSymbol(symbol);
    try {
        // @ts-ignore
        const result = await yahooFinance.options(formattedSymbol);
        if (!result || !result.expirationDates) return [];

        return result.expirationDates.map((d: any) => {
            const dateObj = d instanceof Date ? d : new Date(Number(d) > 10000000000 ? d : Number(d) * 1000);
            return dateObj.toISOString().split('T')[0];
        });
    } catch (err) {
        return [];
    }
}
