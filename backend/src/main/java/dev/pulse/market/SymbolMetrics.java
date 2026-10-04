package dev.pulse.market;

/**
 * One screener row as the frontend sees it. Percent values are already in percent
 * (1.5 means +1.5%), {@code null} means "not enough history yet".
 */
public record SymbolMetrics(
        String symbol,
        double price,
        Double ch1m,
        Double ch5m,
        Double ch15m,
        Double ch1h,
        Double ch24h,
        double vol24h,
        Double surge,
        Double natr,
        Double funding,
        Long nextFunding,
        Double oi,
        Double oiCh15m,
        double liq5m) {
}
