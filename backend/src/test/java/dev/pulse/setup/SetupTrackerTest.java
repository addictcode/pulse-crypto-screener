package dev.pulse.setup;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.Test;

import dev.pulse.setup.SetupTracker.Ending;

class SetupTrackerTest {

    private static final Instant OPENED = Instant.parse("2026-10-11T10:00:00Z");
    private static final Instant EXPIRES = OPENED.plusSeconds(3_600 * 60);

    @Test
    void aLongEndsAtItsStopOrItsTarget() {
        SetupTrade trade = trade(1, 100, 99, 103);

        assertThat(SetupTracker.ending(trade, 100.5, OPENED.plusSeconds(60))).isEmpty();
        assertThat(SetupTracker.ending(trade, 98.7, OPENED.plusSeconds(60))).contains(new Ending(SetupStatus.LOST, 99));
        assertThat(SetupTracker.ending(trade, 103.4, OPENED.plusSeconds(60))).contains(new Ending(SetupStatus.WON, 103));
    }

    @Test
    void aShortIsTheMirror() {
        SetupTrade trade = trade(-1, 100, 101, 97);

        assertThat(SetupTracker.ending(trade, 101.2, OPENED.plusSeconds(60))).contains(new Ending(SetupStatus.LOST, 101));
        assertThat(SetupTracker.ending(trade, 96.9, OPENED.plusSeconds(60))).contains(new Ending(SetupStatus.WON, 97));
    }

    @Test
    void outOfTimeMeansOutAtMarket() {
        SetupTrade trade = trade(1, 100, 99, 103);

        assertThat(SetupTracker.ending(trade, 101.3, EXPIRES.minusSeconds(1))).isEmpty();
        assertThat(SetupTracker.ending(trade, 101.3, EXPIRES)).contains(new Ending(SetupStatus.TIMEOUT, 101.3));
    }

    @Test
    void aSetupThePriceAlreadyRanThroughIsMissed() {
        SetupPlan plan = new SetupPlan(1, 100, 99, 103);

        assertThat(SetupScanner.missed(plan, 100.4)).isFalse();
        assertThat(SetupScanner.missed(plan, 98.9)).isTrue();
        assertThat(SetupScanner.missed(plan, 103)).isTrue();
        assertThat(SetupScanner.missed(new SetupPlan(-1, 100, 101, 97), 101)).isTrue();
    }

    private static SetupTrade trade(int direction, double entry, double stop, double target) {
        return new SetupTrade(1, "TESTUSDT", "1h", direction, entry, stop, target, OPENED, EXPIRES, SetupStatus.OPEN, null, null, null);
    }
}
