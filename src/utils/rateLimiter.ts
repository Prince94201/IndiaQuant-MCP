class RateLimiter {
    private counts: Record<string, { count: number; date: string }> = {};

    private getCurrentDate(): string {
        return new Date().toISOString().split('T')[0];
    }

    checkLimit(apiName: string, dailyLimit: number): boolean {
        const today = this.getCurrentDate();

        if (!this.counts[apiName] || this.counts[apiName].date !== today) {
            this.counts[apiName] = { count: 0, date: today };
        }

        const currentCount = this.counts[apiName].count;

        if (currentCount >= dailyLimit) {
            console.warn(`[RateLimiter] ${apiName} API daily limit (${dailyLimit}) exceeded.`);
            return false;
        }

        if (currentCount >= dailyLimit * 0.8) {
            console.warn(`[RateLimiter] ${apiName} API is approaching daily limit: ${currentCount}/${dailyLimit}`);
        }

        this.counts[apiName].count++;
        return true;
    }
}

export const rateLimiter = new RateLimiter();
