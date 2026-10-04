package dev.pulse.market;

/**
 * A tradable perpetual contract, e.g. BTCUSDT.
 */
public record Instrument(String symbol, String baseAsset, String quoteAsset) {
}
