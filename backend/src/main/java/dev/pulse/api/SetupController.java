package dev.pulse.api;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.setup.SetupJournal;
import dev.pulse.setup.SetupStats;
import dev.pulse.setup.SetupTrade;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/setups")
@RequiredArgsConstructor
public class SetupController {

    static final int DEFAULT_DAYS = 90;
    static final int DEFAULT_LIMIT = 100;
    /** The board the landing and the terminal ask for is kept this long: three queries, not per visitor. */
    static final long TTL_MS = 10_000;

    private record Kept(long at, Board board) {
    }

    private final SetupJournal journal;
    private volatile Kept kept;

    /**
     * The journal as one page shows it: what is open now, what closed lately and the score.
     *
     * @param since when the first setup was taken; null while there are none
     */
    public record Board(List<SetupTrade> open, List<SetupTrade> closed, List<SetupStats> stats, Instant since) {
    }

    @GetMapping
    public Board board(@RequestParam(defaultValue = "" + DEFAULT_DAYS) @Min(1) @Max(365) int days,
                       @RequestParam(defaultValue = "" + DEFAULT_LIMIT) @Min(1) @Max(300) int limit) {
        if (days != DEFAULT_DAYS || limit != DEFAULT_LIMIT) {
            return build(days, limit);
        }
        long now = System.currentTimeMillis();
        Kept current = kept;
        if (current == null || now - current.at() >= TTL_MS) {
            current = new Kept(now, build(days, limit));
            kept = current;
        }
        return current.board();
    }

    private Board build(int days, int limit) {
        return new Board(journal.open(), journal.closed(limit), journal.stats(Instant.now().minus(Duration.ofDays(days))), journal.since());
    }
}
