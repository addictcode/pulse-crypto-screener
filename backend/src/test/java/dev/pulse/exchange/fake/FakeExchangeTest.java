package dev.pulse.exchange.fake;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.depth.OrderBookStore;
import dev.pulse.market.Candle;
import dev.pulse.market.MarketStore;

class FakeExchangeTest {

    @Test
    void fillsTheMarketAndKeepsItsOrderBooksInSync() throws InterruptedException {
        MarketStore market = new MarketStore();
        OrderBookStore books = new OrderBookStore();
        FakeExchange fake = new FakeExchange(market, books, 40, 5);
        try {
            fake.start();
            assertThat(market.symbols()).hasSize(40);
            assertThat(market.price("FAKE000USDT")).isPositive();
            assertThat(books.tracked()).hasSize(5);

            Thread.sleep(1_300);
            assertThat(books.syncedCount()).as("diffs chain onto the snapshot").isEqualTo(5);
            assertThat(fake.status().lastFrameAt()).isNotNull();
            assertThat(fake.status().symbols()).isEqualTo(40);

            List<Candle> hourly = fake.candles("FAKE003USDT", "1h", 50);
            assertThat(hourly).hasSize(50);
            assertThat(hourly.getLast().openTime()).isGreaterThan(hourly.getFirst().openTime());
            assertThat(fake.candles("NOPEUSDT", "1h", 50)).isEmpty();
        } finally {
            fake.stop();
        }
    }
}
