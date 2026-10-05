package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class CooldownsTest {

    private final Cooldowns cooldowns = new Cooldowns(1.5);

    @Test
    void repeatsInsideTheCooldownAreDropped() {
        assertThat(cooldowns.admit(pump(0, 2.1))).isTrue();
        assertThat(cooldowns.admit(pump(60_000, 2.3))).isFalse();
    }

    @Test
    void aClearlyStrongerMoveBreaksThroughTheCooldown() {
        cooldowns.admit(pump(0, 2.1));

        assertThat(cooldowns.admit(pump(60_000, 3.2))).as("3.2 >= 2.1 * 1.5").isTrue();
        assertThat(cooldowns.admit(pump(120_000, 3.5))).as("measured against the last fired, 3.2").isFalse();
    }

    @Test
    void afterTheCooldownTheSameMoveFiresAgain() {
        cooldowns.admit(pump(0, 2.1));

        assertThat(cooldowns.admit(pump(SignalType.PUMP.cooldown().toMillis(), 2.1))).isTrue();
    }

    @Test
    void forWallsCloserIsStronger() {
        assertThat(cooldowns.admit(wall(0, 0.3))).isTrue();
        assertThat(cooldowns.admit(wall(60_000, 0.25))).isFalse();
        assertThat(cooldowns.admit(wall(120_000, 0.15))).as("0.15 <= 0.3 / 1.5").isTrue();
    }

    @Test
    void oneSymbolCannotTakeOverTheFeed() {
        String[] types = {"PUMP", "DUMP", "VOLUME", "OPEN_INTEREST", "FUNDING"};
        int admitted = 0;
        for (int i = 0; i < types.length; i++) {
            if (cooldowns.admit(new Signal(null, SignalType.valueOf(types[i]), "GTCUSDT", i * 60_000L, 1, 10, "", ""))) {
                admitted++;
            }
        }
        assertThat(admitted).isEqualTo(Cooldowns.PER_SYMBOL_PER_HOUR);
        assertThat(cooldowns.admit(new Signal(null, SignalType.WALL, "GTCUSDT", Cooldowns.BUDGET_WINDOW.toMillis() + 1, 1, 0.1, "", "")))
                .as("budget frees up as the first signal leaves the hour window").isTrue();
    }

    @Test
    void restoredHistoryKeepsCoolingDownAfterARestart() {
        cooldowns.restore(List.of(new Signal(1L, SignalType.FUNDING, "AINUSDT", 0, 1, 0.16, "", "")));

        assertThat(cooldowns.admit(new Signal(null, SignalType.FUNDING, "AINUSDT", 60 * 60_000L, 1, 0.17, "", ""))).isFalse();
    }

    @Test
    void rememberedBaselineCoolsDownButLeavesTheBudgetAlone() {
        cooldowns.remember(new Signal(null, SignalType.FUNDING, "AINUSDT", 0, 1, 0.16, "", ""));

        assertThat(cooldowns.admit(new Signal(null, SignalType.FUNDING, "AINUSDT", 60_000, 1, 0.17, "", ""))).isFalse();
        for (int i = 0; i < Cooldowns.PER_SYMBOL_PER_HOUR; i++) {
            SignalType type = SignalType.values()[i];
            assertThat(cooldowns.admit(new Signal(null, type, "AINUSDT", 120_000, 1, 10, "", ""))).as(type.name()).isTrue();
        }
    }

    @Test
    void symbolsAndTypesHaveSeparateCooldowns() {
        cooldowns.admit(pump(0, 2.1));

        assertThat(cooldowns.admit(new Signal(null, SignalType.PUMP, "SOLUSDT", 1_000, 1, 2.1, "", ""))).isTrue();
        assertThat(cooldowns.admit(new Signal(null, SignalType.VOLUME, "WIFUSDT", 1_000, 1, 5, "", ""))).isTrue();
    }

    private static Signal pump(long time, double value) {
        return new Signal(null, SignalType.PUMP, "WIFUSDT", time, 1, value, "", "");
    }

    private static Signal wall(long time, double distance) {
        return new Signal(null, SignalType.WALL, "WIFUSDT", time, 1, distance, "", "");
    }
}
