package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.depth.BookSide;
import dev.pulse.depth.Wall;
import dev.pulse.market.LiquidationTally;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

class DailyDigestTest {

    private static final long NOW = ZonedDateTime.of(2026, 11, 1, 9, 0, 0, 0, ZoneOffset.UTC).toInstant().toEpochMilli();
    private static final long HOUR = 3_600_000L;

    @Test
    void theSharpestMovesAreTheStrongestPumpOrDumpPerCoinOfTheLastDay() {
        List<Signal> signals = List.of(
                signal(SignalType.PUMP, "WIFUSDT", NOW - 2 * HOUR, 4.0, 1.2),
                signal(SignalType.PUMP, "WIFUSDT", NOW - 3 * HOUR, 9.5, -3.0),
                signal(SignalType.DUMP, "SOLUSDT", NOW - 5 * HOUR, 6.1, null),
                signal(SignalType.VOLUME, "PEPEUSDT", NOW - HOUR, 40.0, null),
                signal(SignalType.PUMP, "OLDUSDT", NOW - 25 * HOUR, 30.0, 1.0),
                signal(SignalType.PUMP, "DOGEUSDT", NOW - 6 * HOUR, 2.2, 0.1));

        List<Signal> moves = DailyDigest.sharpest(signals, NOW, 2);

        assertThat(moves).extracting(Signal::symbol).containsExactly("WIFUSDT", "SOLUSDT");
        assertThat(moves.getFirst().value()).isEqualTo(9.5);
    }

    @Test
    void theLargestWallsAreOnePerCoin() {
        List<Wall> walls = List.of(
                wall("BTCUSDT", BookSide.BID, 12e6), wall("BTCUSDT", BookSide.ASK, 9e6),
                wall("ETHUSDT", BookSide.ASK, 5e6), wall("SOLUSDT", BookSide.BID, 1e6));

        assertThat(DailyDigest.largest(walls, 2)).extracting(Wall::symbol, Wall::size)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("BTCUSDT", 12e6), org.assertj.core.groups.Tuple.tuple("ETHUSDT", 5e6));
    }

    @Test
    void theDigestNamesTheCoinsWithWhatFollowedAndSaysItIsNoForecast() {
        String text = DailyDigest.format(
                List.of(signal(SignalType.PUMP, "WIFUSDT", NOW - 3 * HOUR, 9.5, -3.04),
                        signal(SignalType.DUMP, "SOLUSDT", NOW - 20 * 60_000, 6.1, null)),
                new LiquidationTally.Totals(3_200_000, 1_100_000, NOW - 24 * HOUR),
                List.of(wall("BTCUSDT", BookSide.BID, 12.4e6)), NOW, false);

        assertThat(text)
                .contains("WIF +9.5% in 5 min, 06:00 UTC; an hour later −3.0%")
                .contains("SOL −6.1% in 5 min, 08:40 UTC; the hour is not up yet")
                .contains("$4.3M: longs $3.2M, shorts $1.1M")
                .doesNotContain("since")
                .contains("BTC bid $12.4M at 84,210.0 (−0.40%)")
                .contains("not a forecast", "Not financial advice");
    }

    @Test
    void inRussianWithAPartDayOfLiquidationsAndNothingYet() {
        String text = DailyDigest.format(List.of(), new LiquidationTally.Totals(0, 0, NOW - 5 * HOUR), List.of(), NOW, true);

        assertThat(text)
                .contains("Pulse за сутки")
                .contains("Ни одного пампа или дампа")
                .contains("Ни одной в потоке биржи (с 04:00 UTC)")
                .contains("Стаканы ещё синхронизируются")
                .contains("не прогноз", "Не финансовый совет");
    }

    @Test
    void theDigestIsDueOnceInItsHour() {
        ZonedDateTime nine = ZonedDateTime.of(2026, 11, 1, 9, 30, 0, 0, ZoneOffset.UTC);

        assertThat(TelegramBot.digestDue(9, nine, null)).isTrue();
        assertThat(TelegramBot.digestDue(9, nine, LocalDate.of(2026, 10, 31))).isTrue();
        assertThat(TelegramBot.digestDue(9, nine, LocalDate.of(2026, 11, 1))).as("already posted today").isFalse();
        assertThat(TelegramBot.digestDue(9, nine.withHour(10), null)).isFalse();
        assertThat(TelegramBot.digestDue(null, nine, null)).as("off by default").isFalse();
    }

    private static Signal signal(SignalType type, String symbol, long time, double value, Double ret1h) {
        return new Signal(1L, type, symbol, time, 1.0, value, "title", "detail", type == SignalType.DUMP ? -1 : 1, null, null, ret1h);
    }

    private static Wall wall(String symbol, BookSide side, double size) {
        return new Wall(symbol, side, 84_210, size, side == BookSide.BID ? -0.4 : 0.4, 8, 600, 12.0);
    }
}
