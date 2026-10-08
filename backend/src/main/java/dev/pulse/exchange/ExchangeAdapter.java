package dev.pulse.exchange;

import java.util.List;

import dev.pulse.market.Candle;

/**
 * An exchange integration. Implementations push normalized events into a
 * {@link dev.pulse.market.MarketSink}; adding Bybit or OKX later means one more implementation.
 */
public interface ExchangeAdapter {

    String name();

    /**
     * Historical candles straight from the exchange, oldest first.
     *
     * @param interval exchange-style interval such as 1m, 5m, 1h, 1d
     */
    List<Candle> candles(String symbol, String interval, int limit);

    ExchangeStatus status();

    /**
     * How often the symbol pays funding. Rates are quoted per interval, so two rates only
     * compare once both are brought to the same number of hours.
     */
    default int fundingIntervalHours(String symbol) {
        return 8;
    }
}
