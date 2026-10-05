package dev.pulse.account;

import dev.pulse.signal.SignalType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * How one user wants one signal type. A missing row means enabled with the system threshold.
 */
@Entity
@Table(name = "signal_preference")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SignalPreference {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Setter(AccessLevel.NONE)
    private Long id;

    @Column(name = "user_id", nullable = false)
    @Setter(AccessLevel.NONE)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    @Setter(AccessLevel.NONE)
    private SignalType type;

    @Column(nullable = false)
    private boolean enabled = true;

    /** {@code null} means the system floor. */
    private Double threshold;

    static SignalPreference defaults(long userId, SignalType type) {
        SignalPreference p = new SignalPreference();
        p.userId = userId;
        p.type = type;
        return p;
    }
}
