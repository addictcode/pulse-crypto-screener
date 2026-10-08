package dev.pulse.alert;

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

@Entity
@Table(name = "price_alert")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class PriceAlertEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 32)
    private String symbol;

    @Column(name = "price_level", nullable = false)
    private double level;

    @Column(nullable = false)
    private boolean above;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "fired_at")
    private Instant firedAt;

    static PriceAlertEntity of(long userId, String symbol, double level, boolean above) {
        PriceAlertEntity alert = new PriceAlertEntity();
        alert.userId = userId;
        alert.symbol = symbol;
        alert.level = level;
        alert.above = above;
        alert.createdAt = Instant.now();
        return alert;
    }

    void fire(Instant at) {
        firedAt = at;
    }

    PriceAlert toAlert() {
        return new PriceAlert(id, userId, symbol, level, above);
    }
}
