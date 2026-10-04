package dev.pulse.market;

/**
 * Rolling 24h statistics for a symbol.
 */
public record TickerUpdate(
        String symbol,
        double lastPrice,
        double openPrice24h,
        double highPrice24h,
        double lowPrice24h,
        double quoteVolume24h,
        long eventTime) {
}
