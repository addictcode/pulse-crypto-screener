package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

class WeeklySummaryTest {

    private static final long NOW = ZonedDateTime.of(2026, 11, 9, 9, 0, 0, 0, ZoneOffset.UTC).toInstant().toEpochMilli();

    private static Signal pump(String symbol, long ago, double value, Double ret1h) {
        return new Signal(1L, SignalType.PUMP, symbol, NOW - ago, 1, value, "t", "", 1, null, null, ret1h);
    }

    @Test
    void comesOnMondaysInItsHour() {
        ZonedDateTime monday = ZonedDateTime.of(2026, 11, 9, 9, 30, 0, 0, ZoneOffset.UTC);
        assertThat(WeeklySummary.due(9, monday)).isTrue();
        assertThat(WeeklySummary.due(9, monday.plusDays(1))).isFalse();
        assertThat(WeeklySummary.due(9, monday.withHour(10))).isFalse();
        assertThat(WeeklySummary.due(-1, monday)).as("off").isFalse();
    }

    @Test
    void isAboutTheirPairsWhenTheyHaveAny() {
        List<Signal> week = List.of(pump("WIFUSDT", 86_400_000L, 9, 1.0), pump("SOLUSDT", 86_400_000L, 4, -2.0), pump("OLDUSDT", 8 * 86_400_000L, 30, 0.0));
        assertThat(WeeklySummary.moves(week, List.of("SOLUSDT"), NOW)).extracting(Signal::symbol).containsExactly("SOLUSDT");
        assertThat(WeeklySummary.moves(week, List.of(), NOW)).extracting(Signal::symbol).containsExactly("WIFUSDT", "SOLUSDT");
    }

    @Test
    void saysWhatHappenedAndHowToStopIt() {
        String ru = WeeklySummary.format(List.of(pump("WIFUSDT", 86_400_000L, 9.5, -3.04)), true, true);
        assertThat(ru).contains("Твоя неделя в Pulse", "Самое резкое по твоему избранному", "WIF +9.5% за 5 мин", "через час −3.0%", "/weekly off", "Не финансовый совет");
        String quiet = WeeklySummary.format(List.of(), false, false);
        assertThat(quiet).contains("A quiet week", "/watch WIF makes this about your pairs");
    }
}
