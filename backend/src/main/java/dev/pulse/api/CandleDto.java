package dev.pulse.api;

import dev.pulse.market.Candle;

/**
 * Chart-friendly candle: {@code time} in epoch seconds, which is what the chart library expects.
 */
public record CandleDto(long time, double open, double high, double low, double close, double volume) {

    static CandleDto from(Candle c) {
        return new CandleDto(c.openTime() / 1000, c.open(), c.high(), c.low(), c.close(), Math.round(c.quoteVolume()));
    }
}
