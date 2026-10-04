package dev.pulse.exchange;

/**
 * An exchange integration. Implementations push normalized events into a
 * {@link dev.pulse.market.MarketSink}; adding Bybit or OKX later means one more implementation.
 */
public interface ExchangeAdapter {

    String name();

    ExchangeStatus status();
}
