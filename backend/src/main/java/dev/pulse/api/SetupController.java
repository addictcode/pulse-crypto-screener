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

    private final SetupJournal journal;

    /**
     * The journal as one page shows it: what is open now, what closed lately and the score.
     *
     * @param since when the first setup was taken; null while there are none
     */
    public record Board(List<SetupTrade> open, List<SetupTrade> closed, List<SetupStats> stats, Instant since) {
    }

    @GetMapping
    public Board board(@RequestParam(defaultValue = "90") @Min(1) @Max(365) int days,
                       @RequestParam(defaultValue = "100") @Min(1) @Max(300) int limit) {
        return new Board(journal.open(), journal.closed(limit), journal.stats(Instant.now().minus(Duration.ofDays(days))), journal.since());
    }
}
