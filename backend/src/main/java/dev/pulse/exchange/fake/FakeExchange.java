package dev.pulse.exchange.fake;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.SplittableRandom;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import dev.pulse.depth.DepthSnapshot;
import dev.pulse.depth.DepthUpdate;
import dev.pulse.depth.OrderBook;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarkPriceUpdate;
import dev.pulse.market.MarketSink;
import dev.pulse.market.PositionSide;
import dev.pulse.market.TickerUpdate;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * A made-up market for load tests where the exchange cannot be reached: random-walk prices for
 * a Binance-sized list of perpetuals, at Binance's update rates (tickers and mark prices every
 * second, a candle update per symbol every two, a few liquidations a second, order book diffs for
 * the 60 largest books four times a second). The numbers are fake and nothing marks them as
 * real; it is off unless {@code pulse.fake-market.enabled=true}, and never meant for a public site.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.fake-market", name = "enabled", havingValue = "true")
public class FakeExchange implements ExchangeAdapter {

    private static final long MINUTE = 60_000;
    private static final int BOOK_LEVELS = 1000;
    private static final int HISTORY = 120;

    private final MarketSink sink;
    private final OrderBookStore books;
    private final int symbolCount;
    private final int bookCount;
    private final ScheduledExecutorService timer = Executors.newScheduledThreadPool(2, Thread.ofPlatform().daemon().factory());
    private final SplittableRandom random = new SplittableRandom(7);

    private List<Instrument> instruments = List.of();
    private final Map<String, Integer> index = new HashMap<>();
    private double[] price;
    private double[] open24h;
    private double[] volume24h;
    private Candle[] candle;
    private long[] bookIds;
    private volatile Long lastFrame;

    public FakeExchange(MarketSink sink, OrderBookStore books,
                        @Value("${pulse.fake-market.symbols:530}") int symbolCount,
                        @Value("${pulse.fake-market.books:60}") int bookCount) {
        this.sink = sink;
        this.books = books;
        this.symbolCount = symbolCount;
        this.bookCount = Math.min(bookCount, symbolCount);
    }

    @Override
    public String name() {
        return "fake";
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        List<Instrument> list = new ArrayList<>();
        price = new double[symbolCount];
        open24h = new double[symbolCount];
        volume24h = new double[symbolCount];
        candle = new Candle[symbolCount];
        bookIds = new long[symbolCount];
        long now = System.currentTimeMillis();
        for (int i = 0; i < symbolCount; i++) {
            String base = String.format("FAKE%03d", i);
            list.add(new Instrument(base + "USDT", base, "USDT"));
            index.put(base + "USDT", i);
            // a few large coins, a long tail of small ones, like the real list
            price[i] = Math.pow(10, 4.5 - 7.0 * i / symbolCount) * (1 + random.nextDouble());
            open24h[i] = price[i] * (1 + (random.nextDouble() - 0.5) * 0.1);
            volume24h[i] = 2e10 / Math.pow(i + 1, 1.3);
        }
        instruments = List.copyOf(list);
        sink.onInstruments(instruments);
        for (int i = 0; i < symbolCount; i++) {
            sink.onCandleHistory(instruments.get(i).symbol(), history(i, now));
            sink.onTicker(ticker(i, now));
        }
        for (int i = 0; i < bookCount; i++) {
            String symbol = instruments.get(i).symbol();
            books.track(symbol);
            bookIds[i] = 1_000;
            books.onSnapshot(snapshot(i));
        }
        timer.scheduleAtFixedRate(this::tickers, 1_000, 1_000, TimeUnit.MILLISECONDS);
        timer.scheduleAtFixedRate(this::candles, 500, 500, TimeUnit.MILLISECONDS);
        timer.scheduleAtFixedRate(this::depth, 250, 250, TimeUnit.MILLISECONDS);
        log.warn("Fake market: {} made-up symbols, {} order books. Load tests only, never a public site.", symbolCount, bookCount);
    }

    private List<Candle> history(int i, long now) {
        List<Candle> bars = new ArrayList<>();
        double p = price[i];
        long minute = now / MINUTE * MINUTE;
        for (int k = HISTORY; k > 0; k--) {
            double next = p * (1 + (random.nextDouble() - 0.5) * 0.004);
            bars.add(new Candle(minute - k * MINUTE, p, Math.max(p, next) * 1.001, Math.min(p, next) * 0.999, next, volume24h[i] / 1440, true));
            p = next;
        }
        price[i] = p;
        candle[i] = new Candle(minute, p, p, p, p, 0, false);
        return bars;
    }

    private synchronized void tickers() {
        long now = System.currentTimeMillis();
        for (int i = 0; i < symbolCount; i++) {
            sink.onTicker(ticker(i, now));
            sink.onMarkPrice(new MarkPriceUpdate(instruments.get(i).symbol(), price[i], (random.nextDouble() - 0.4) * 0.0004,
                    (now / (8 * 3_600_000L) + 1) * 8 * 3_600_000L, now));
        }
        for (int k = 0; k < 3; k++) {
            int i = random.nextInt(symbolCount);
            sink.onLiquidation(new Liquidation(instruments.get(i).symbol(), random.nextBoolean() ? PositionSide.LONG : PositionSide.SHORT,
                    price[i], 5_000 / price[i] * (1 + random.nextDouble() * 20), now));
        }
        // open interest once a minute, like the poll against the exchange
        if (now / 1_000 % 60 == 0) {
            for (int i = 0; i < symbolCount; i++) {
                sink.onOpenInterest(instruments.get(i).symbol(), volume24h[i] / price[i] / 3, now);
            }
        }
        lastFrame = now;
    }

    private TickerUpdate ticker(int i, long now) {
        return new TickerUpdate(instruments.get(i).symbol(), price[i], open24h[i], Math.max(open24h[i], price[i]) * 1.02,
                Math.min(open24h[i], price[i]) * 0.98, volume24h[i], now);
    }

    /** Half the symbols a tick, so each gets a candle update every second, as the kline stream does. */
    private synchronized void candles() {
        long now = System.currentTimeMillis();
        long minute = now / MINUTE * MINUTE;
        int half = (int) (now / 500 % 2);
        for (int i = half; i < symbolCount; i += 2) {
            Candle c = candle[i];
            if (c.openTime() < minute) {
                sink.onCandle(instruments.get(i).symbol(), new Candle(c.openTime(), c.open(), c.high(), c.low(), c.close(), c.quoteVolume(), true));
                c = new Candle(minute, c.close(), c.close(), c.close(), c.close(), 0, false);
            }
            // now and then a sharp minute, so the detectors have something to say
            double step = random.nextInt(20_000) == 0 ? (random.nextBoolean() ? 0.03 : -0.03) : (random.nextDouble() - 0.5) * 0.002;
            price[i] = c.close() * (1 + step);
            c = new Candle(c.openTime(), c.open(), Math.max(c.high(), price[i]), Math.min(c.low(), price[i]), price[i],
                    c.quoteVolume() + volume24h[i] / 1440 / 120 * (0.5 + random.nextDouble()), false);
            candle[i] = c;
            sink.onCandle(instruments.get(i).symbol(), c);
        }
    }

    private DepthSnapshot snapshot(int i) {
        double[][] side = levels(i, -1, BOOK_LEVELS);
        double[][] other = levels(i, 1, BOOK_LEVELS);
        return new DepthSnapshot(instruments.get(i).symbol(), bookIds[i], side[0], side[1], other[0], other[1]);
    }

    /** Levels a tick apart from the price outward; every 97th is a wall. */
    private double[][] levels(int i, int direction, int count) {
        double tick = price[i] * 0.0001;
        double[] prices = new double[count];
        double[] quantities = new double[count];
        for (int k = 0; k < count; k++) {
            prices[k] = price[i] + direction * tick * (k + 1);
            double usd = 2_000 + random.nextDouble() * 8_000 + (k % 97 == 50 ? 400_000 : 0);
            quantities[k] = usd / prices[k];
        }
        return new double[][] {prices, quantities};
    }

    private synchronized void depth() {
        long now = System.currentTimeMillis();
        for (int i = 0; i < bookCount; i++) {
            double[][] bids = levels(i, -1, 10);
            double[][] asks = levels(i, 1, 10);
            long previous = bookIds[i];
            bookIds[i] = previous + 1;
            DepthUpdate update = new DepthUpdate(instruments.get(i).symbol(), bookIds[i], bookIds[i], previous, now,
                    bids[0], bids[1], asks[0], asks[1]);
            if (books.onUpdate(update) == OrderBook.Status.NEEDS_SNAPSHOT) {
                books.onSnapshot(snapshot(i));
            }
        }
    }

    @Override
    public synchronized List<Candle> candles(String symbol, String interval, int limit) {
        Integer i = index.get(symbol);
        if (i == null) {
            return List.of();
        }
        long step = switch (interval) {
            case "1m" -> MINUTE;
            case "5m" -> 5 * MINUTE;
            case "15m" -> 15 * MINUTE;
            case "1h" -> 60 * MINUTE;
            case "4h" -> 240 * MINUTE;
            default -> 1_440 * MINUTE;
        };
        Random walk = new Random(symbol.hashCode() * 31L + step);
        List<Candle> bars = new ArrayList<>();
        double p = price[i];
        long now = System.currentTimeMillis() / step * step;
        for (int k = 0; k < limit; k++) {
            double prev = p / (1 + (walk.nextDouble() - 0.5) * 0.01);
            bars.addFirst(new Candle(now - k * step, prev, Math.max(p, prev) * 1.002, Math.min(p, prev) * 0.998, p, volume24h[i] * step / 86_400_000.0, k > 0));
            p = prev;
        }
        return bars;
    }

    @Override
    public ExchangeStatus status() {
        return new ExchangeStatus(name(), instruments.size(), instruments.size(), 1, 1, lastFrame);
    }

    @PreDestroy
    void stop() {
        timer.shutdownNow();
    }
}
