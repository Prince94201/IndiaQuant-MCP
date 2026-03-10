import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
    newsApiKey: process.env.NEWS_API_KEY || '',
    alphaVantageKey: process.env.ALPHA_VANTAGE_KEY || '',
    riskFreeRate: parseFloat(process.env.RISK_FREE_RATE || '0.065'),
    defaultVirtualCash: parseFloat(process.env.DEFAULT_VIRTUAL_CASH || '1000000'),
    dbPath: process.env.PORTFOLIO_DB_PATH || path.resolve(__dirname, '../data/portfolio.db')
};
