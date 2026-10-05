package dev.pulse.signal;

import java.util.ArrayList;
import java.util.List;

import dev.pulse.market.SymbolMetrics;

/**
 * Loose thresholds for the live tape: the screen should feel alive, so these fire far more often
 * than {@link SignalRules}. Nothing here is stored or pushed to Telegram.
 */
public final class TapeRules {

    static final double MOVE_1M = 1.0;
    static final double MOVE_5M = 2.0;
    static final double VOLUME = 3.0;
    static final double OPEN_INTEREST = 2.5;
    static final double LIQUIDATIONS = 150_000;

    private TapeRules() {
    }

    public static List<TapeItem> evaluate(SymbolMetrics m, double longLiquidated, double shortLiquidated,
                                          double minVolume24h, long now) {
        List<TapeItem> items = new ArrayList<>();
        if (m.vol24h() < minVolume24h || m.price() <= 0) {
            return items;
        }
        if (m.ch1m() != null && Math.abs(m.ch1m()) >= MOVE_1M) {
            items.add(item(m.ch1m() > 0 ? TapeKind.PUMP_1M : TapeKind.DUMP_1M, m, now, m.ch1m()));
        }
        if (m.ch5m() != null && Math.abs(m.ch5m()) >= MOVE_5M) {
            items.add(item(m.ch5m() > 0 ? TapeKind.PUMP_5M : TapeKind.DUMP_5M, m, now, m.ch5m()));
        }
        if (m.surge() != null && m.surge() >= VOLUME) {
            items.add(item(TapeKind.VOLUME, m, now, m.surge()));
        }
        if (m.oiCh15m() != null && Math.abs(m.oiCh15m()) >= OPEN_INTEREST) {
            items.add(item(m.oiCh15m() > 0 ? TapeKind.OI_UP : TapeKind.OI_DOWN, m, now, m.oiCh15m()));
        }
        if (longLiquidated + shortLiquidated >= LIQUIDATIONS) {
            boolean longs = longLiquidated >= shortLiquidated;
            items.add(item(longs ? TapeKind.LIQ_LONGS : TapeKind.LIQ_SHORTS, m, now, longLiquidated + shortLiquidated));
        }
        return items;
    }

    private static TapeItem item(TapeKind kind, SymbolMetrics m, long now, double value) {
        return new TapeItem(kind, m.symbol(), now, m.price(), Math.round(value * 100) / 100.0);
    }
}
