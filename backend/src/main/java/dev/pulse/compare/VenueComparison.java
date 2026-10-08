package dev.pulse.compare;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.bybit.BybitFeed;
import dev.pulse.exchange.bybit.BybitQuote;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;

/**
 * Joins the Binance market with Bybit tickers, symbol by symbol. Contracts are matched by name:
 * both venues call the same thing BTCUSDT or 1000PEPEUSDT.
 */
@Service
public class VenueComparison {

    private static final double PERIODS_PER_YEAR = 3 * 365;

    private final MarketStore market;
    private final ObjectProvider<BybitFeed> bybit;
    private final List<ExchangeAdapter> exchanges;

    public VenueComparison(MarketStore market, ObjectProvider<BybitFeed> bybit, List<ExchangeAdapter> exchanges) {
        this.market = market;
        this.bybit = bybit;
        this.exchanges = exchanges;
    }

    /** Every symbol listed on both venues; empty while Bybit is off or unreachable. */
    public List<VenueGap> gaps() {
        BybitFeed feed = bybit.getIfAvailable();
        Map<String, BybitQuote> quotes = feed == null ? Map.of() : feed.quotes();
        if (quotes.isEmpty()) {
            return List.of();
        }
        List<VenueGap> gaps = new ArrayList<>();
        for (SymbolMetrics home : market.snapshot(System.currentTimeMillis())) {
            BybitQuote away = quotes.get(home.symbol());
            if (away != null && home.price() > 0) {
                gaps.add(compare(home, homeFundingHours(home.symbol()), away));
            }
        }
        return gaps;
    }

    private int homeFundingHours(String symbol) {
        return exchanges.isEmpty() ? 8 : exchanges.getFirst().fundingIntervalHours(symbol);
    }

    static VenueGap compare(SymbolMetrics home, int homeHours, BybitQuote away) {
        Double spread8h = home.funding() == null || away.funding() == null
                ? null
                : home.funding() * 8 / homeHours - away.funding() * 8 / away.fundingHours();
        Double oiShare = home.oi() == null || away.oi() == null || home.oi() + away.oi() <= 0
                ? null
                : away.oi() / (home.oi() + away.oi());
        return new VenueGap(
                home.symbol(),
                away.price(),
                round((away.price() / home.price() - 1) * 100, 3),
                round(away.funding(), 4),
                away.fundingHours(),
                homeHours,
                round(spread8h, 4),
                round(spread8h == null ? null : spread8h * PERIODS_PER_YEAR, 1),
                round(away.oi(), 0),
                round(oiShare, 3),
                Math.round(away.vol24h()));
    }

    private static Double round(Double value, int decimals) {
        if (value == null || value.isNaN() || value.isInfinite()) {
            return null;
        }
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }
}
