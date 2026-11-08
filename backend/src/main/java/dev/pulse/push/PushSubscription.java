package dev.pulse.push;

import java.time.Instant;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

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

/** A browser that asked for notifications, and what it asked for. */
@Entity
@Table(name = "push_subscription")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class PushSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Setter(AccessLevel.NONE)
    private Long id;

    @Column(nullable = false, unique = true, length = 1024)
    @Setter(AccessLevel.NONE)
    private String endpoint;

    /** the browser's P-256 public key, base64url */
    @Column(nullable = false, length = 128)
    private String p256dh;

    @Column(nullable = false, length = 64)
    private String auth;

    @Column(nullable = false, length = 2048)
    private String symbols;

    @Column(name = "strong_only", nullable = false)
    private boolean strongOnly;

    @Column(nullable = false, length = 2)
    private String lang;

    @Column(name = "created_at", nullable = false)
    @Setter(AccessLevel.NONE)
    private Instant createdAt;

    PushSubscription(String endpoint, Instant createdAt) {
        this.endpoint = endpoint;
        this.createdAt = createdAt;
    }

    Set<String> symbolSet() {
        return symbols.isBlank() ? Set.of() : Arrays.stream(symbols.split(",")).collect(Collectors.toUnmodifiableSet());
    }
}
