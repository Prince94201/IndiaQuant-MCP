import { db } from '../db/database.js';
import { getLivePrice, getHistoricalOHLC } from './marketData.js';
import { formatSymbol } from '../utils/symbolFormatter.js';

export async function placeVirtualTrade(symbol: string, quantity: number, side: 'BUY' | 'SELL') {
    const formattedSymbol = formatSymbol(symbol);
    const liveData = await getLivePrice(formattedSymbol);
    const price = liveData.price;

    if (price <= 0) {
        throw new Error(`Invalid price for ${formattedSymbol}`);
    }

    const cost = price * quantity;
    const orderId = `ORD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const accountRow = await db.get('SELECT cashBalance FROM account WHERE id = 1');
    let cashBalance = accountRow.cashBalance;

    // SQLite doesn't have an exact equivalent to better-sqlite3's `db.transaction()` wrapper for async,
    // so we handle it manually.
    await db.run('BEGIN TRANSACTION');

    try {
        if (side === 'BUY') {
            if (cashBalance < cost) {
                throw new Error(`Insufficient funds. Cost: ${cost}, Balance: ${cashBalance}`);
            }
            cashBalance -= cost;
        } else {
            const pos = await db.get('SELECT quantity, avgPrice FROM positions WHERE symbol = ? AND side = ?', [formattedSymbol, 'BUY']);

            if (!pos || pos.quantity < quantity) {
                throw new Error(`Insufficient quantity to sell. Have: ${pos?.quantity || 0}, Trying to sell: ${quantity}`);
            }
            cashBalance += cost;
        }

        await db.run('UPDATE account SET cashBalance = ? WHERE id = 1', [cashBalance]);

        await db.run('INSERT INTO trades (orderId, symbol, side, quantity, price, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
            [orderId, formattedSymbol, side, quantity, price, new Date().toISOString()]
        );

        const existing = await db.get('SELECT quantity, avgPrice FROM positions WHERE symbol = ? AND side = ?', [formattedSymbol, 'BUY']);

        if (side === 'BUY') {
            if (existing) {
                const newQty = existing.quantity + quantity;
                const newAvgPrice = ((existing.avgPrice * existing.quantity) + cost) / newQty;
                await db.run('UPDATE positions SET quantity = ?, avgPrice = ? WHERE symbol = ? AND side = ?',
                    [newQty, newAvgPrice, formattedSymbol, 'BUY']
                );
            } else {
                await db.run('INSERT INTO positions (symbol, quantity, avgPrice, side) VALUES (?, ?, ?, ?)',
                    [formattedSymbol, quantity, price, 'BUY']
                );
            }
        } else {
            if (existing) {
                const newQty = existing.quantity - quantity;
                if (newQty === 0) {
                    await db.run('DELETE FROM positions WHERE symbol = ? AND side = ?', [formattedSymbol, 'BUY']);
                } else {
                    await db.run('UPDATE positions SET quantity = ? WHERE symbol = ? AND side = ?', [newQty, formattedSymbol, 'BUY']);
                }
            }
        }
        await db.run('COMMIT');
    } catch (e) {
        await db.run('ROLLBACK');
        throw e;
    }

    return {
        orderId,
        symbol: formattedSymbol,
        executedPrice: price,
        quantity,
        side,
        status: 'FILLED',
        timestamp: new Date().toISOString()
    };
}

export async function getPortfolioPnL() {
    const positions = await db.all('SELECT symbol, quantity, avgPrice, side FROM positions');
    const accountRow = await db.get('SELECT cashBalance FROM account WHERE id = 1');

    let totalInvested = 0;
    let currentValue = 0;
    let totalPnL = 0;

    const enrichedPositions = [];

    for (const pos of positions) {
        try {
            const live = await getLivePrice(pos.symbol);
            const invested = pos.quantity * pos.avgPrice;
            const current = pos.quantity * live.price;
            const pnl = current - invested;
            const pnlPercent = (pnl / invested) * 100;

            totalInvested += invested;
            currentValue += current;
            totalPnL += pnl;

            enrichedPositions.push({
                symbol: pos.symbol,
                quantity: pos.quantity,
                avgPrice: pos.avgPrice,
                currentPrice: live.price,
                invested,
                currentValue: current,
                pnl,
                pnlPercent
            });
        } catch (e) {
            console.error(`Could not price position ${pos.symbol}`);
        }
    }

    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    return {
        positions: enrichedPositions,
        totalInvested,
        currentValue,
        totalPnL,
        totalPnLPercent,
        cashBalance: accountRow.cashBalance
    };
}

export async function checkAndTriggerStopLoss() {
    const positions = await db.all('SELECT symbol, quantity, avgPrice, side FROM positions');
    const triggered = [];

    for (const pos of positions) {
        try {
            const live = await getLivePrice(pos.symbol);
            const lossPercent = ((live.price - pos.avgPrice) / pos.avgPrice) * 100;

            if (lossPercent <= -5.0 && pos.side === 'BUY') {
                const trade = await placeVirtualTrade(pos.symbol, pos.quantity, 'SELL');
                triggered.push({
                    symbol: pos.symbol,
                    sellPrice: trade.executedPrice,
                    lossPercent,
                    orderId: trade.orderId
                });
            }
        } catch (e) {
            // ignore
        }
    }

    return triggered;
}

export async function calculatePositionRisk(symbol: string) {
    const formattedSymbol = formatSymbol(symbol);
    const ohlc = await getHistoricalOHLC(formattedSymbol, '1mo', '1d');

    if (ohlc.length < 2) {
        return { riskScore: 5, varEstimate: 0, warning: 'Not enough data' };
    }

    const returns = [];
    for (let i = 1; i < ohlc.length; i++) {
        const prev = ohlc[i - 1].close;
        const curr = ohlc[i].close;
        if (prev > 0) {
            returns.push((curr - prev) / prev);
        }
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    const annVol = stdDev * Math.sqrt(252);

    let riskScore = Math.min(10, Math.max(1, Math.ceil(annVol * 10)));

    const var95 = 1.65 * stdDev;

    return {
        riskScore,
        varEstimatePercent: (var95 * 100).toFixed(2),
        annualizedVolatilityPercent: (annVol * 100).toFixed(2)
    };
}
