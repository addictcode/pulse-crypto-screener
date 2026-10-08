package dev.pulse.signal;

import java.util.ArrayList;
import java.util.List;

import dev.pulse.depth.BookSide;
import dev.pulse.depth.Wall;
import dev.pulse.market.SymbolMetrics;

import static dev.pulse.signal.Text.base;
import static dev.pulse.signal.Text.num;
import static dev.pulse.signal.Text.pct;
import static dev.pulse.signal.Text.price;
import static dev.pulse.signal.Text.usd;

/**
 * The detection rules, as pure functions of one symbol's current state. Thresholds here are the
 * system floors from {@link SignalType}; per-user thresholds are applied later, at delivery.
 */
public final class SignalRules {

    /** Volume spikes on thin markets are routine, so the surge rule wants a busier market. */
    static final double VOLUME_LIQUIDITY_FACTOR = 4;
    /** Liquidations matter relative to the market: $500k is a lot for an altcoin, routine for BTC. */
    static final double LIQUIDATION_VOLUME_SHARE = 0.0005;
    /** A wall that has stood this long is real; fresh ones are often pulled before the price arrives. */
    static final long WALL_MIN_AGE_SECONDS = 120;
    static final double WALL_MIN_SIZE = 500_000;
    static final double WALL_MIN_MULTIPLE = 10;

    private SignalRules() {
    }

    /**
     * @param longLiquidated  USD of long positions liquidated in the last 5 minutes
     * @param shortLiquidated USD of short positions liquidated in the last 5 minutes
     * @param nearestWall     the wall closest to the price, or {@code null}
     */
    public static List<Signal> evaluate(SymbolMetrics m, double longLiquidated, double shortLiquidated, Wall nearestWall,
                                        double minVolume24h, long now) {
        List<Signal> signals = new ArrayList<>();
        if (m.vol24h() < minVolume24h || m.price() <= 0) {
            return signals;
        }
        String sym = base(m.symbol());

        if (m.ch5m() != null && m.ch5m() >= SignalType.PUMP.floor()) {
            signals.add(signal(SignalType.PUMP, m, now, m.ch5m(), 1, sym + " jumps " + num(m.ch5m(), 1) + "% in five minutes"));
        }
        if (m.ch5m() != null && -m.ch5m() >= SignalType.DUMP.floor()) {
            signals.add(signal(SignalType.DUMP, m, now, -m.ch5m(), -1, sym + " falls " + num(-m.ch5m(), 1) + "% in five minutes"));
        }
        if (m.surge() != null && m.surge() >= SignalType.VOLUME.floor() && m.vol24h() >= minVolume24h * VOLUME_LIQUIDITY_FACTOR) {
            signals.add(signal(SignalType.VOLUME, m, now, m.surge(), sign(m.ch5m()), sym + " volume runs at " + num(m.surge(), 1) + "× the hourly pace"));
        }
        if (m.oiCh15m() != null && Math.abs(m.oiCh15m()) >= SignalType.OPEN_INTEREST.floor()) {
            String verb = m.oiCh15m() > 0 ? "climbs" : "drops";
            signals.add(signal(SignalType.OPEN_INTEREST, m, now, Math.abs(m.oiCh15m()), sign(m.oiCh15m()),
                    "Open interest in " + sym + " " + verb + " " + num(Math.abs(m.oiCh15m()), 1) + "% in 15 minutes"));
        }
        if (m.funding() != null && Math.abs(m.funding()) >= SignalType.FUNDING.floor()) {
            String who = m.funding() < 0 ? "shorts pay longs" : "longs pay shorts";
            signals.add(signal(SignalType.FUNDING, m, now, Math.abs(m.funding()), sign(m.funding()),
                    sym + " funding at " + pct(m.funding(), 3) + ", " + who));
        }
        double liquidated = longLiquidated + shortLiquidated;
        if (liquidated >= Math.max(SignalType.LIQUIDATIONS.floor(), m.vol24h() * LIQUIDATION_VOLUME_SHARE)) {
            String side = longLiquidated >= shortLiquidated ? "longs" : "shorts";
            // liquidated shorts are forced buys: the event points up
            signals.add(signal(SignalType.LIQUIDATIONS, m, now, liquidated, longLiquidated >= shortLiquidated ? -1 : 1,
                    usd(liquidated) + " of " + sym + " " + side + " liquidated in five minutes"));
        }
        if (nearestWall != null && isEstablished(nearestWall) && Math.abs(nearestWall.distance()) <= SignalType.WALL.floor()) {
            double distance = Math.abs(nearestWall.distance());
            String where = nearestWall.side() == BookSide.BID
                    ? "above a " + usd(nearestWall.size()) + " bid wall"
                    : "below a " + usd(nearestWall.size()) + " ask wall";
            signals.add(signal(SignalType.WALL, m, now, distance, nearestWall.side() == BookSide.BID ? 1 : -1, sym + " trades " + num(distance, 2) + "% " + where));
        }
        return signals;
    }

    static boolean isEstablished(Wall wall) {
        return wall.age() >= WALL_MIN_AGE_SECONDS && wall.size() >= WALL_MIN_SIZE && wall.multiple() >= WALL_MIN_MULTIPLE;
    }

    /**
     * Second line of every signal: the context a trader checks next, minus whatever the title
     * already says ("volume runs at 4.1×" does not need "volume 4.1×" underneath).
     */
    static String detail(SymbolMetrics m, SignalType type) {
        StringBuilder text = new StringBuilder("Price ").append(price(m.price()));
        if (m.ch24h() != null) {
            text.append(", ").append(pct(m.ch24h(), 1)).append(" on the day");
        }
        text.append('.');
        List<String> context = new ArrayList<>();
        if (m.surge() != null && type != SignalType.VOLUME) {
            context.add("volume " + num(m.surge(), 1) + "× the hourly pace");
        }
        if (m.oiCh15m() != null && type != SignalType.OPEN_INTEREST) {
            context.add("open interest " + pct(m.oiCh15m(), 1) + " over 15 minutes");
        }
        if (!context.isEmpty()) {
            String joined = String.join(", ", context);
            text.append(' ').append(Character.toUpperCase(joined.charAt(0))).append(joined.substring(1)).append('.');
        }
        return text.toString();
    }

    private static int sign(Double value) {
        return value == null ? 0 : (int) Math.signum(value);
    }

    private static Signal signal(SignalType type, SymbolMetrics m, long now, double value, int direction, String title) {
        return new Signal(null, type, m.symbol(), now, m.price(), value, title, detail(m, type)).withDirection(direction);
    }
}
