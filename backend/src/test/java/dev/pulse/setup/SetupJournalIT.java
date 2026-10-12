package dev.pulse.setup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketStore;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class SetupJournalIT {

    @Autowired
    private SetupJournal journal;
    @Autowired
    private MarketStore market;

    @Test
    void aTradeIsFollowedFromItsOpenToItsEndAndCounted() {
        // a timeframe of its own, so trades other tests left behind do not get into the count
        String timeframe = UUID.randomUUID().toString().substring(0, 8);
        String symbol = "STP" + timeframe.substring(0, 4).toUpperCase() + "USDT";
        market.onInstruments(List.of(new Instrument(symbol, "STP", "USDT")));
        price(symbol, 100.2);
        // whole milliseconds: the database keeps microseconds and rounds, so a time with nanoseconds
        // can come back a hair later than it went in
        Instant opened = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        List<Object> published = new ArrayList<>();
        SetupTracker tracker = new SetupTracker(journal, market, published::add);

        SetupTrade trade = journal.open(symbol, timeframe, new SetupPlan(1, 100, 99, 103), opened, opened.plusSeconds(3_600));
        assertThat(journal.holds(symbol, timeframe)).isTrue();
        tracker.follow(opened.plusSeconds(30));
        assertThat(published).isEmpty();

        price(symbol, 103.2);
        tracker.follow(opened.plusSeconds(60));
        tracker.follow(opened.plusSeconds(62));

        assertThat(published).hasSize(1);
        SetupTrade closed = ((SetupClosed) published.getFirst()).trade();
        assertThat(closed.id()).isEqualTo(trade.id());
        assertThat(closed.status()).isEqualTo(SetupStatus.WON);
        assertThat(closed.resultR()).isCloseTo(2.9, within(1e-9));
        assertThat(journal.holds(symbol, timeframe)).isFalse();
        assertThat(journal.closed(300)).extracting(SetupTrade::id).contains(trade.id());
        assertThat(journal.stats(opened.minusSeconds(60))).filteredOn(s -> s.timeframe().equals(timeframe))
                .singleElement()
                .satisfies(s -> {
                    assertThat(s.trades()).isEqualTo(1);
                    assertThat(s.wins()).isEqualTo(1);
                    assertThat(s.netR()).isCloseTo(2.9, within(1e-9));
                });
        assertThat(journal.since()).isBeforeOrEqualTo(opened);
    }

    private void price(String symbol, double value) {
        market.onCandle(symbol, new Candle(System.currentTimeMillis() / 60_000 * 60_000, value, value, value, value, 1_000, false));
    }
}
