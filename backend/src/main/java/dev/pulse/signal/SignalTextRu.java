package dev.pulse.signal;

import java.util.Locale;

/**
 * The headline of a signal in Russian. The backend writes titles in English; this rebuilds the
 * Russian one from the signal's fields, word for word like web/src/signal-text.ts, so a push, the
 * bot and the site say the same thing.
 */
public final class SignalTextRu {

    private SignalTextRu() {
    }

    public static String title(Signal s) {
        String sym = Text.base(s.symbol());
        boolean up = s.direction() > 0;
        boolean down = s.direction() < 0;
        return switch (s.type()) {
            case PUMP -> sym + " растёт на " + v(s, 1) + "% за 5 минут";
            case DUMP -> sym + " падает на " + v(s, 1) + "% за 5 минут";
            case VOLUME -> sym + ": объём в " + v(s, 1) + "× выше часового темпа";
            case OPEN_INTEREST -> "Открытый интерес " + sym + " " + (up ? "вырос" : down ? "упал" : "изменился") + " на " + v(s, 1) + "% за 15 минут";
            case FUNDING -> up ? sym + ": фандинг +" + v(s, 3) + "%, лонги платят шортам"
                    : down ? sym + ": фандинг −" + v(s, 3) + "%, шорты платят лонгам"
                    : sym + ": фандинг " + v(s, 3) + "% от нуля";
            case LIQUIDATIONS -> sym + ": " + Text.usd(s.value()) + " " + (down ? "лонгов" : up ? "шортов" : "позиций") + " ликвидировано за 5 минут";
            case WALL -> up ? sym + " в " + v(s, 2) + "% над стеной на покупку"
                    : down ? sym + " в " + v(s, 2) + "% под стеной на продажу"
                    : sym + " в " + v(s, 2) + "% от стены";
        };
    }

    private static String v(Signal s, int digits) {
        return String.format(Locale.ROOT, "%." + digits + "f", s.value()).replace('.', ',');
    }
}
