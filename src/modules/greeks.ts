export function normPDF(x: number): number {
    return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

// Approximation for Normal CDF (Abramowitz and Stegun)
export function normCDF(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const z = Math.abs(x) / Math.sqrt(2.0);
    const t = 1.0 / (1.0 + 0.3275911 * z);
    const p = (((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592;
    const erf = 1.0 - p * t * Math.exp(-z * z);
    return 0.5 * (1.0 + sign * erf);
}

export interface GreeksInput {
    S: number;      // Spot price
    K: number;      // Strike price
    T: number;      // Time to expiry in years
    r: number;      // Risk-free rate (e.g., 0.065 for 6.5%)
    sigma: number;  // Implied volatility (e.g., 0.2 for 20%)
    type: 'CE' | 'PE'; // Call or Put
}

export interface GreeksOutput {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    theoreticalPrice: number;
}

export function calculateGreeks(input: GreeksInput): GreeksOutput {
    const { S, K, T, r, sigma, type } = input;

    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
        return {
            delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, theoreticalPrice: 0
        };
    }

    const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2.0) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    const Nd1 = normCDF(d1);
    const Nd2 = normCDF(d2);
    const nd1 = normPDF(d1);

    let delta, theta, rho, price;
    const gamma = nd1 / (S * sigma * Math.sqrt(T));
    const vega = (S * nd1 * Math.sqrt(T)) / 100.0;

    if (type === 'CE') {
        delta = Nd1;
        theta = (-(S * nd1 * sigma) / (2.0 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * Nd2) / 365.0;
        rho = (K * T * Math.exp(-r * T) * Nd2) / 100.0;
        price = S * Nd1 - K * Math.exp(-r * T) * Nd2;
    } else {
        const N_minus_d1 = normCDF(-d1);
        const N_minus_d2 = normCDF(-d2);

        delta = Nd1 - 1.0;
        theta = (-(S * nd1 * sigma) / (2.0 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * N_minus_d2) / 365.0;
        rho = (-K * T * Math.exp(-r * T) * N_minus_d2) / 100.0;
        price = K * Math.exp(-r * T) * N_minus_d2 - S * N_minus_d1;
    }

    return {
        delta,
        gamma,
        theta,
        vega,
        rho,
        theoreticalPrice: price
    };
}
