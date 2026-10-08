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

    @Column(nullable = false)
    private int direction;

    @Column(name = "ret_5m")
    private Double ret5m;

    @Column(name = "ret_15m")
    private Double ret15m;

    @Column(name = "ret_1h")
    private Double ret1h;

    static SignalEntity from(Signal s) {
        SignalEntity e = new SignalEntity();
        e.type = s.type();
        e.symbol = s.symbol();
        e.firedAt = Instant.ofEpochMilli(s.time());
        e.price = s.price();
        e.value = s.value();
        e.title = s.title();
        e.detail = s.detail();
        e.direction = s.direction();
        return e;
    }

    void setOutcome(Horizon horizon, double changePct) {
        switch (horizon) {
            case M5 -> ret5m = changePct;
            case M15 -> ret15m = changePct;
            case H1 -> ret1h = changePct;
        }
    }

    Signal toSignal() {
        return new Signal(id, type, symbol, firedAt.toEpochMilli(), price, value, title, detail, direction, ret5m, ret15m, ret1h);
    }
}
