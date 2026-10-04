package dev.pulse.market;

import java.util.List;

/**
 * Receives normalized market events from an exchange adapter.
 * Adapters only translate exchange formats; everything they produce lands here.
 */
public interface MarketSink {

    void onInstruments(List<Instrument> instruments);

    void onTicker(TickerUpdate ticker);

    void onMarkPrice(MarkPriceUpdate markPrice);

    void onCandle(String symbol, Candle candle);

    void onCandleHistory(String symbol, List<Candle> candles);

    void onOpenInterest(String symbol, double contracts, long time);

    void onLiquidation(Liquidation liquidation);
}
