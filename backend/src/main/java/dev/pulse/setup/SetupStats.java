package dev.pulse.setup;

/**
 * How the finished setups of one timeframe have done.
 *
 * @param netR sum of all results in R, after fees
 */
public record SetupStats(String timeframe, Long trades, Long wins, Double netR) {
}
