package dev.pulse.clienterror;

import java.time.Clock;
import java.time.Duration;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.OwnerNotice;

/**
 * Once a day: errors from visitors' browsers that are new or grew since the last summary go to
 * the owner (the bot's chat, if the bot runs, and the log either way), and errors not seen for a
 * day are forgotten. A quiet day sends nothing.
 */
@Component
public class ClientErrorSummary {

    static final Duration KEEP = Duration.ofDays(1);
    static final int LISTED = 5;

    private static final Logger log = LoggerFactory.getLogger(ClientErrorSummary.class);

    private final ClientErrorLog errors;
    private final ApplicationEventPublisher events;
    private final boolean enabled;
    private final Clock clock;

    @Autowired
    public ClientErrorSummary(ClientErrorLog errors, ApplicationEventPublisher events,
                              @Value("${pulse.client-errors.enabled:true}") boolean enabled) {
        this(errors, events, enabled, Clock.systemUTC());
    }

    ClientErrorSummary(ClientErrorLog errors, ApplicationEventPublisher events, boolean enabled, Clock clock) {
        this.errors = errors;
        this.events = events;
        this.enabled = enabled;
        this.clock = clock;
    }

    /** 06:41 UTC: morning in Minsk, before the day's traffic. */
    @Scheduled(cron = "${pulse.client-errors.summary-cron:0 41 6 * * *}", zone = "UTC")
    public void daily() {
        if (!enabled) {
            return;
        }
        List<ClientErrorLog.Row> fresh = errors.unreported();
        if (!fresh.isEmpty()) {
            String text = text(fresh);
            log.warn("{}", text);
            events.publishEvent(new OwnerNotice(text));
            errors.reported(fresh);
        }
        errors.forgetBefore(clock.instant().minus(KEEP));
    }

    static String text(List<ClientErrorLog.Row> rows) {
        long total = rows.stream().mapToLong(ClientErrorLog.Row::newCount).sum();
        StringBuilder text = new StringBuilder("Browser errors since the last summary: %d, %d different.".formatted(total, rows.size()));
        for (ClientErrorLog.Row r : rows.subList(0, Math.min(LISTED, rows.size()))) {
            String frame = r.stack().lines().filter(l -> l.strip().startsWith("at ") || l.contains("@")).findFirst().orElse("").strip();
            text.append("\n\n×").append(r.newCount()).append(' ').append(r.page()).append(" [").append(r.lang()).append(", ")
                    .append(r.build()).append("]\n").append(r.message());
            if (!frame.isEmpty()) {
                text.append("\n").append(frame.length() > 160 ? frame.substring(0, 160) : frame);
            }
        }
        if (rows.size() > LISTED) {
            text.append("\n\n…and ").append(rows.size() - LISTED).append(" more in the client_error table.");
        }
        return text.toString();
    }
}
