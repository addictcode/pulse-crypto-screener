package dev.pulse.market;

/**
 * Mark price and funding. {@code fundingRate} is a fraction (0.0001 means 0.01%).
 */
public record MarkPriceUpdate(String symbol, double markPrice, double fundingRate, long nextFundingTime, long eventTime) {
}
