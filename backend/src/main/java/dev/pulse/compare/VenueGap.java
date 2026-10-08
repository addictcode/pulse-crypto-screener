package dev.pulse.compare;

/**
 * One symbol on Binance against the same contract on Bybit. Percent values are in percent.
 *
 * @param price         Bybit last price
 * @param gap           how far Bybit trades from Binance: +0.05 means Bybit is 0.05% higher
 * @param funding       Bybit funding rate per {@code fundingHours}
 * @param homeHours     the Binance funding interval, for the rate in the screener row
 * @param spread8h      Binance funding minus Bybit funding, both brought to 8 hours. Positive:
 *                      longs pay more on Binance, so short Binance and long Bybit collects it
 * @param spreadApr     the same spread held for a year
 * @param oi            Bybit open interest in USD
 * @param oiShare       Bybit's part of the open interest on both venues, 0..1
 */
public record VenueGap(
        String symbol,
        double price,
        Double gap,
        Double funding,
        int fundingHours,
        int homeHours,
        Double spread8h,
        Double spreadApr,
        Double oi,
        Double oiShare,
        double vol24h) {
}
