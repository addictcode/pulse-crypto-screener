package dev.pulse.premium;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One payment in Telegram Stars and the end of the premium period it bought. */
@Entity
@Table(name = "premium_payment")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class PremiumPayment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "telegram_chat_id", nullable = false)
    private long telegramChatId;

    /** Telegram's id of the charge, also what a refund needs. */
    @Column(name = "charge_id", nullable = false, unique = true, length = 128)
    private String chargeId;

    @Column(nullable = false)
    private int stars;

    @Column(name = "paid_at", nullable = false)
    private Instant paidAt;

    @Column(name = "active_until", nullable = false)
    private Instant activeUntil;

    PremiumPayment(long telegramChatId, String chargeId, int stars, Instant paidAt, Instant activeUntil) {
        this.telegramChatId = telegramChatId;
        this.chargeId = chargeId;
        this.stars = stars;
        this.paidAt = paidAt;
        this.activeUntil = activeUntil;
    }
}
