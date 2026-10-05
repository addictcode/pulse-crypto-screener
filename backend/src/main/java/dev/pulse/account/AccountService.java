package dev.pulse.account;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import dev.pulse.signal.SignalType;
import lombok.RequiredArgsConstructor;

/**
 * Per-user preferences. Every method takes a user id, never "the owner": the single-user
 * setup lives in the Telegram layer, not here.
 */
@Service
@RequiredArgsConstructor
public class AccountService {

    private final UserAccountRepository users;
    private final SignalPreferenceRepository preferences;
    private final WatchlistItemRepository watchlist;

    @Transactional
    public UserAccount telegramUser(long chatId) {
        return users.findByTelegramChatId(chatId).orElseGet(() -> users.save(UserAccount.forTelegram(chatId)));
    }

    @Transactional(readOnly = true)
    public List<DeliverySettings> telegramRecipients() {
        return users.findByTelegramChatIdIsNotNull().stream().map(this::settings).toList();
    }

    @Transactional(readOnly = true)
    public DeliverySettings settings(long userId) {
        return settings(users.findById(userId).orElseThrow());
    }

    @Transactional
    public void setEnabled(long userId, SignalType type, boolean enabled) {
        preference(userId, type).setEnabled(enabled);
    }

    /**
     * @throws IllegalArgumentException when the threshold is looser than the system floor
     */
    @Transactional
    public void setThreshold(long userId, SignalType type, Double threshold) {
        if (threshold != null && !type.isAllowedThreshold(threshold)) {
            throw new IllegalArgumentException("threshold below the system floor of " + type.floor());
        }
        preference(userId, type).setThreshold(threshold);
    }

    @Transactional
    public Instant mute(long userId, Duration duration) {
        Instant until = duration == null ? null : Instant.now().plus(duration);
        users.findById(userId).orElseThrow().setMutedUntil(until);
        return until;
    }

    @Transactional
    public void setWatchlistOnly(long userId, boolean watchlistOnly) {
        users.findById(userId).orElseThrow().setWatchlistOnly(watchlistOnly);
    }

    /** @return false if the symbol was already there */
    @Transactional
    public boolean watch(long userId, String symbol) {
        if (watchlist.existsByUserIdAndSymbol(userId, symbol)) {
            return false;
        }
        watchlist.save(WatchlistItem.of(userId, symbol));
        return true;
    }

    /** @return false if the symbol was not on the watchlist */
    @Transactional
    public boolean unwatch(long userId, String symbol) {
        return watchlist.deleteByUserIdAndSymbol(userId, symbol) > 0;
    }

    private SignalPreference preference(long userId, SignalType type) {
        return preferences.findByUserId(userId).stream()
                .filter(p -> p.getType() == type)
                .findFirst()
                .orElseGet(() -> preferences.save(SignalPreference.defaults(userId, type)));
    }

    private DeliverySettings settings(UserAccount user) {
        Set<SignalType> disabled = EnumSet.noneOf(SignalType.class);
        Map<SignalType, Double> thresholds = new EnumMap<>(SignalType.class);
        for (SignalPreference p : preferences.findByUserId(user.getId())) {
            if (!p.isEnabled()) {
                disabled.add(p.getType());
            }
            if (p.getThreshold() != null) {
                thresholds.put(p.getType(), p.getThreshold());
            }
        }
        Set<String> symbols = watchlist.findByUserIdOrderBySymbol(user.getId()).stream()
                .map(WatchlistItem::getSymbol)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        return new DeliverySettings(user.getId(), user.getTelegramChatId(), user.getMutedUntil(), user.isWatchlistOnly(),
                symbols, disabled, thresholds);
    }
}
