package dev.pulse.premium;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

/**
 * Who has premium and until when. Payments arrive from the bot; anything that should behave
 * differently for premium asks {@link #active}. Nothing does yet: free users get what they got.
 */
@Service
@RequiredArgsConstructor
public class PremiumService {

    private final PremiumPaymentRepository payments;
    private final PremiumProperties properties;

    public boolean enabled() {
        return properties.enabled();
    }

    public PremiumProperties properties() {
        return properties;
    }

    /** The end of the chat's premium, if it has one now. */
    @Transactional(readOnly = true)
    public Optional<Instant> activeUntil(long chatId, Instant now) {
        return payments.findFirstByTelegramChatIdOrderByActiveUntilDesc(chatId)
                .map(PremiumPayment::getActiveUntil)
                .filter(until -> until.isAfter(now));
    }

    public boolean active(long chatId, Instant now) {
        return activeUntil(chatId, now).isPresent();
    }

    /**
     * Whether a pre-checkout query is for our invoice at today's price: Telegram asks before taking
     * the Stars, and a stale invoice sent at another price must not go through.
     */
    public boolean acceptable(String payload, String currency, int amount) {
        return properties.enabled() && PremiumProperties.PAYLOAD.equals(payload) && "XTR".equals(currency)
                && amount == properties.priceStars();
    }

    /**
     * Records a successful payment and returns the new end of premium: a period from now, or from
     * the current end if premium is still running. The same charge twice changes nothing.
     */
    @Transactional
    public Instant recordPayment(long chatId, String chargeId, int stars, Instant now) {
        Optional<PremiumPayment> known = payments.findByChargeId(chargeId);
        if (known.isPresent()) {
            return known.get().getActiveUntil();
        }
        Instant from = activeUntil(chatId, now).orElse(now);
        Instant until = from.plus(Duration.ofDays(properties.days()));
        payments.save(new PremiumPayment(chatId, chargeId, stars, now, until));
        return until;
    }
}
