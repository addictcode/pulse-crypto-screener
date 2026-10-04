package dev.pulse.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;

/**
 * Plain HTTP view of the same data the WebSocket streams. Handy for debugging with curl
 * and for clients that only need one look at the market.
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class MarketController {

    private final MarketStore store;
    private final List<ExchangeAdapter> exchanges;

    @GetMapping("/market")
    public List<SymbolMetrics> market() {
        return store.snapshot(System.currentTimeMillis());
    }

    @GetMapping("/liquidations")
    public List<Liquidation> liquidations(@RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return store.recentLiquidations(limit);
    }

    @GetMapping("/status")
    public List<ExchangeStatus> status() {
        return exchanges.stream().map(ExchangeAdapter::status).toList();
    }
}
