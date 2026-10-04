package dev.pulse.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.depth.Wall;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/density")
@RequiredArgsConstructor
public class DensityController {

    public record DensityStatus(int tracked, long synced, int walls, long scannedAt) {
    }

    private final DensityScanner scanner;
    private final OrderBookStore books;

    /** All walls, or the walls of one symbol. */
    @GetMapping("/walls")
    public List<Wall> walls(@RequestParam(required = false) String symbol) {
        return symbol == null ? scanner.latest().walls() : scanner.walls(symbol);
    }

    @GetMapping("/status")
    public DensityStatus status() {
        DensityScanner.DensityState state = scanner.latest();
        return new DensityStatus(books.tracked().size(), books.syncedCount(), state.walls().size(), state.ts());
    }
}
