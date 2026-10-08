package dev.pulse.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.compare.VenueComparison;
import dev.pulse.compare.VenueGap;
import lombok.RequiredArgsConstructor;

/**
 * Binance against Bybit. Polled by the browser rather than streamed: funding spreads move
 * slowly, and a price gap is only as fresh as the last Bybit poll anyway.
 */
@RestController
@RequestMapping("/api/compare")
@RequiredArgsConstructor
public class CompareController {

    private final VenueComparison comparison;

    @GetMapping
    public List<VenueGap> compare() {
        return comparison.gaps();
    }
}
