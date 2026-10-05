package dev.pulse.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/signals")
@RequiredArgsConstructor
public class SignalController {

    private final SignalHistory history;

    /** Newest first; with a symbol, that pair's history from the database. */
    @GetMapping
    public List<Signal> signals(@RequestParam(required = false) String symbol,
                                @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return symbol == null ? history.recent(limit) : history.recentFor(symbol, limit);
    }
}
