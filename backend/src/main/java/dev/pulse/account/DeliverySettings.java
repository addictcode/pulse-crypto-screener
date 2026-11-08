package dev.pulse.account;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

/**
 * Everything needed to decide whether one user gets one signal, loaded once and checked in memory.
 *
 * @param thresholds per type; a missing type uses the system floor
 * @param lang       "en" or "ru" when chosen with /lang, null to follow the person's Telegram app
 */
public record DeliverySettings(
        long userId,
        Long telegramChatId,
        Instant mutedUntil,
        boolean watchlistOnly,
        Set<String> watchlist,
        Set<SignalType> disabled,
        Map<SignalType, Double> thresholds,
        String lang) {

    public DeliverySettings(long userId, Long telegramChatId, Instant mutedUntil, boolean watchlistOnly, Set<String> watchlist,
                            Set<SignalType> disabled, Map<SignalType, Double> thresholds) {
        this(userId, telegramChatId, mutedUntil, watchlistOnly, watchlist, disabled, thresholds, null);
    }

    /** Russian, if the person chose it, or else if their Telegram app is in Russian. */
    public boolean russian(boolean telegramRussian) {
        return lang == null ? telegramRussian : "ru".equals(lang);
    }

    public boolean wants(Signal signal, Instant now) {
        if (mutedUntil != null && now.isBefore(mutedUntil)) {
            return false;
        }
        if (disabled.contains(signal.type())) {
            return false;
        }
        if (watchlistOnly && !watchlist.contains(signal.symbol())) {
            return false;
        }
        Double threshold = thresholds.get(signal.type());
        return threshold == null || signal.type().meets(signal.value(), threshold);
    }

    public double thresholdFor(SignalType type) {
        return thresholds.getOrDefault(type, type.floor());
    }
}
