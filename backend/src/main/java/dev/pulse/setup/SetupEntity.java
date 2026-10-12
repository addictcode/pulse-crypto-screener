package dev.pulse.setup;

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
@Table(name = "setup_trade")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class SetupEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 32)
    private String symbol;

    @Column(nullable = false, length = 8)
    private String timeframe;

    @Column(nullable = false)
    private int direction;

    @Column(name = "entry_price", nullable = false)
    private double entry;

    @Column(name = "stop_price", nullable = false)
    private double stop;

    @Column(name = "target_price", nullable = false)
    private double target;

    @Column(name = "opened_at", nullable = false)
    private Instant openedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private SetupStatus status;

    @Column(name = "closed_at")
    private Instant closedAt;

    @Column(name = "exit_price")
    private Double exitPrice;

    @Column(name = "result_r")
    private Double resultR;

    static SetupEntity open(String symbol, String timeframe, SetupPlan plan, Instant at, Instant expiresAt) {
        SetupEntity trade = new SetupEntity();
        trade.symbol = symbol;
        trade.timeframe = timeframe;
        trade.direction = plan.direction();
        trade.entry = plan.entry();
        trade.stop = plan.stop();
        trade.target = plan.target();
        trade.openedAt = at;
        trade.expiresAt = expiresAt;
        trade.status = SetupStatus.OPEN;
        return trade;
    }

    void close(SetupStatus outcome, double exit, double result, Instant at) {
        status = outcome;
        exitPrice = exit;
        resultR = result;
        closedAt = at;
    }

    SetupTrade toTrade() {
        return new SetupTrade(id, symbol, timeframe, direction, entry, stop, target, openedAt, expiresAt, status, closedAt, exitPrice, resultR);
    }
}
