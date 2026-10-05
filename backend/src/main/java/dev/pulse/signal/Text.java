package dev.pulse.signal;

import java.util.Locale;

/**
 * Number formatting for signal text, matching what the web UI shows.
 */
public final class Text {

    private static final String MINUS = "−";

    private Text() {
    }

    /** BTCUSDT -> BTC */
    public static String base(String symbol) {
        return symbol.endsWith("USDT") ? symbol.substring(0, symbol.length() - 4) : symbol;
    }

    public static String price(double v) {
        int digits = v >= 1000 ? 1 : v >= 10 ? 2 : v >= 0.1 ? 4 : v >= 0.01 ? 5 : v >= 0.001 ? 6 : 7;
        return String.format(Locale.US, "%,." + digits + "f", v);
    }

    public static String usd(double v) {
        if (v >= 1e9) return String.format(Locale.US, "$%.2fB", v / 1e9);
        if (v >= 1e6) return String.format(Locale.US, "$%.1fM", v / 1e6);
        if (v >= 1e3) return String.format(Locale.US, "$%.1fK", v / 1e3);
        return String.format(Locale.US, "$%.0f", v);
    }

    /** Signed percent with a real minus sign: +2.84%, −0.21% */
    public static String pct(double v, int digits) {
        String abs = String.format(Locale.US, "%." + digits + "f%%", Math.abs(v));
        return (v > 0 ? "+" : v < 0 ? MINUS : "") + abs;
    }

    /** Unsigned magnitude: 2.8 */
    public static String num(double v, int digits) {
        return String.format(Locale.US, "%." + digits + "f", v);
    }
}
