package dev.pulse.market;

import java.util.List;

/**
 * How the market is positioned in one symbol over time: what the exchange publishes about open
 * interest, the long/short split and funding. Every series is oldest first; a series the
 * exchange could not provide is empty rather than failing the rest.
 *
 * @param openInterest       open interest in USD
 * @param longShortAccounts  accounts net long divided by accounts net short, all traders
 * @param longShortTop       the same ratio by position size among the largest traders
 * @param takerBuySell       volume of market buys divided by market sells
 * @param funding            funding rate in percent at each payment
 */
public record Positioning(
        List<Point> openInterest,
        List<Point> longShortAccounts,
        List<Point> longShortTop,
        List<Point> takerBuySell,
        List<Point> funding) {

    public static final Positioning EMPTY = new Positioning(List.of(), List.of(), List.of(), List.of(), List.of());

    /** @param time epoch seconds, which is what the chart library expects */
    public record Point(long time, double value) {
    }
}
