package dev.pulse.signal;

import java.time.Instant;

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

@Entity
@Table(name = "signal")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class SignalEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private SignalType type;

    @Column(nullable = false, length = 32)
    private String symbol;

    @Column(name = "fired_at", nullable = false)
    private Instant firedAt;

    @Column(nullable = false)
    private double price;

    @Column(nullable = false)
    private double value;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, length = 400)
    private String detail;

    static SignalEntity from(Signal s) {
        SignalEntity e = new SignalEntity();
        e.type = s.type();
        e.symbol = s.symbol();
        e.firedAt = Instant.ofEpochMilli(s.time());
        e.price = s.price();
        e.value = s.value();
        e.title = s.title();
        e.detail = s.detail();
        return e;
    }

    Signal toSignal() {
        return new Signal(id, type, symbol, firedAt.toEpochMilli(), price, value, title, detail);
    }
}
