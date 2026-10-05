package dev.pulse.account;

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
import lombok.Setter;

/**
 * A person using Pulse. For now that is only the owner, known by their Telegram chat;
 * a login for the web UI would add columns here, not a new model.
 */
@Entity
@Table(name = "app_user")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Setter(AccessLevel.NONE)
    private Long id;

    @Column(name = "telegram_chat_id", unique = true)
    private Long telegramChatId;

    @Column(name = "created_at", nullable = false)
    @Setter(AccessLevel.NONE)
    private Instant createdAt;

    /** No signals are delivered before this moment. */
    @Column(name = "muted_until")
    private Instant mutedUntil;

    /** Deliver only signals for symbols on the watchlist. */
    @Column(name = "watchlist_only", nullable = false)
    private boolean watchlistOnly;

    public static UserAccount forTelegram(long chatId) {
        UserAccount user = new UserAccount();
        user.telegramChatId = chatId;
        user.createdAt = Instant.now();
        return user;
    }
}
