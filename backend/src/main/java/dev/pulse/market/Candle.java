package dev.pulse.market;

/**
 * One-minute OHLC bar. {@code quoteVolume} is the traded value in USDT.
 */
public record Candle(long openTime, double open, double high, double low, double close, double quoteVolume, boolean closed) {
}
