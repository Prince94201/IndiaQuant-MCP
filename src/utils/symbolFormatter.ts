const INDEX_SYMBOLS = ['^NSEI', '^NSEBANK', '^BSESN'];

const COMPANY_NAMES: Record<string, string> = {
    'RELIANCE.NS': 'Reliance Industries',
    'HDFCBANK.NS': 'HDFC Bank',
    'INFY.NS': 'Infosys',
    'TCS.NS': 'Tata Consultancy Services',
    'ICICIBANK.NS': 'ICICI Bank',
    'WIPRO.NS': 'Wipro',
    'HCLTECH.NS': 'HCL Technologies',
    'TECHM.NS': 'Tech Mahindra'
};

export function formatSymbol(symbol: string): string {
    if (isIndex(symbol)) return symbol;

    if (!symbol.endsWith('.NS') && !symbol.endsWith('.BO')) {
        return `${symbol}.NS`;
    }
    return symbol;
}

export function isIndex(symbol: string): boolean {
    return INDEX_SYMBOLS.includes(symbol);
}

export function getCompanyName(symbol: string): string {
    const formatted = formatSymbol(symbol);
    if (COMPANY_NAMES[formatted]) {
        return COMPANY_NAMES[formatted];
    }

    // Basic fallback
    const baseSymbol = formatted.replace(/\.(NS|BO)$/, '');
    return baseSymbol;
}
