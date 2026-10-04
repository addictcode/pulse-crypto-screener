package dev.pulse.api;

import java.util.List;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.market.MarketStore;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;

/**
 * Chart history. The live part of the chart comes from the market stream,
 * this endpoint only fills in the past.
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class CandleController {

    private static final Set<String> INTERVALS = Set.of("1m", "5m", "15m", "1h", "4h", "1d");

    private final List<ExchangeAdapter> exchanges;
    private final MarketStore store;

    @GetMapping("/candles")
    public List<CandleDto> candles(@RequestParam String symbol,
                                   @RequestParam(defaultValue = "5m") String interval,
                                   @RequestParam(defaultValue = "300") @Min(10) @Max(1000) int limit) {
        if (!INTERVALS.contains(interval)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "interval must be one of " + INTERVALS);
        }
        // only symbols we track: keeps the endpoint from becoming an open proxy to the exchange
        if (!store.isListed(symbol)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown symbol " + symbol);
        }
        ExchangeAdapter exchange = exchanges.stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "no exchange connected"));
        return exchange.candles(symbol, interval, limit).stream().map(CandleDto::from).toList();
    }
}
