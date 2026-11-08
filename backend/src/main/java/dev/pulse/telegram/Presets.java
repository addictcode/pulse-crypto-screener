package dev.pulse.telegram;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;

import dev.pulse.account.AccountService;
import dev.pulse.signal.SignalType;

/**
 * Three ready settings for people who do not want to tune seven signal types by hand. A newcomer
 * starts on "calm": everything at once makes people mute or leave within a day.
 */
enum Presets {

    /** Strong pumps, dumps and liquidations only, twice the system floor. */
    CALM("calm", "Calm", "Спокойно", Map.of(SignalType.PUMP, 2.0, SignalType.DUMP, 2.0, SignalType.LIQUIDATIONS, 2.0)),
    /** The moves and the money behind them at the system floor; funding and walls off. */
    NORMAL("normal", "Normal", "Обычно", Map.of(SignalType.PUMP, 1.0, SignalType.DUMP, 1.0, SignalType.VOLUME, 1.0,
            SignalType.OPEN_INTEREST, 1.0, SignalType.LIQUIDATIONS, 1.0)),
    /** Every type at the system floor. */
    ALL("all", "Everything", "Всё", Map.of(SignalType.PUMP, 1.0, SignalType.DUMP, 1.0, SignalType.VOLUME, 1.0, SignalType.OPEN_INTEREST, 1.0,
            SignalType.FUNDING, 1.0, SignalType.LIQUIDATIONS, 1.0, SignalType.WALL, 1.0));

    final String key;
    final String en;
    final String ru;
    /** the types that are on, each with its threshold as a multiple of the floor */
    private final Map<SignalType, Double> on;

    Presets(String key, String en, String ru, Map<SignalType, Double> on) {
        this.key = key;
        this.en = en;
        this.ru = ru;
        this.on = on;
    }

    void apply(AccountService accounts, long userId) {
        for (SignalType type : SignalType.values()) {
            Double factor = on.get(type);
            accounts.setEnabled(userId, type, factor != null);
            if (factor == null || factor == 1.0) {
                accounts.setThreshold(userId, type, null);
            } else {
                accounts.setThreshold(userId, type, type.higherIsStronger() ? type.floor() * factor : type.floor() / factor);
            }
        }
    }

    static Optional<Presets> fromKey(String key) {
        for (Presets p : values()) {
            if (p.key.equals(key == null ? "" : key.toLowerCase(Locale.ROOT))) {
                return Optional.of(p);
            }
        }
        return Optional.empty();
    }

    /** SignalType's label in Russian, as the site names the types. */
    static String labelRu(SignalType type) {
        return switch (type) {
            case PUMP -> "Памп";
            case DUMP -> "Дамп";
            case VOLUME -> "Объём";
            case OPEN_INTEREST -> "Открытый интерес";
            case FUNDING -> "Фандинг";
            case LIQUIDATIONS -> "Ликвидации";
            case WALL -> "У стены";
        };
    }

    static String descriptionRu(SignalType type) {
        return switch (type) {
            case PUMP -> "цена выросла хотя бы на столько за 5 минут";
            case DUMP -> "цена упала хотя бы на столько за 5 минут";
            case VOLUME -> "торгуют во столько раз быстрее часового темпа";
            case OPEN_INTEREST -> "открытый интерес изменился на столько за 15 минут";
            case FUNDING -> "фандинг хотя бы так далеко от нуля";
            case LIQUIDATIONS -> "ликвидировано за 5 минут, не меньше";
            case WALL -> "цена ближе этого к устоявшейся стене";
        };
    }
}
