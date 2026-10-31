package dev.pulse.telegram;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Function;

import dev.pulse.visit.FunnelStep;
import dev.pulse.visit.VisitCount;
import dev.pulse.visit.VisitSource;

/**
 * The owner's /visits: the funnel by day, then by source, as monospace tables narrow enough for
 * a phone. Steps nobody reached in the period are left out rather than shown as a column of zeros.
 */
final class VisitReport {

    static final int DEFAULT_DAYS = 7;
    static final int MAX_DAYS = 90;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("MM-dd", Locale.ROOT);

    private VisitReport() {
    }

    /** "/visits", "/visits 30", "/visits 30d"; anything else is the default week. */
    static int days(String arg) {
        if (arg == null) {
            return DEFAULT_DAYS;
        }
        try {
            return Math.max(1, Math.min(MAX_DAYS, Integer.parseInt(arg.toLowerCase(Locale.ROOT).replace("d", ""))));
        } catch (NumberFormatException e) {
            return DEFAULT_DAYS;
        }
    }

    /** The first day of a period of {@code days} days that ends today. */
    static LocalDate from(LocalDate today, int days) {
        return today.minusDays(days - 1L);
    }

    static String format(List<VisitCount> rows, int days) {
        if (rows.isEmpty()) {
            return "No visits in the last " + days + " d yet.";
        }
        List<FunnelStep> steps = Arrays.stream(FunnelStep.values())
                .filter(step -> rows.stream().anyMatch(r -> r.step() == step && r.count() > 0))
                .toList();
        Map<String, Map<FunnelStep, Long>> byDay = table(rows, r -> DAY.format(r.day()));
        Map<String, Map<FunnelStep, Long>> bySource = table(rows, r -> r.source().key());
        // sources in a fixed order, the same every time the owner looks
        Map<String, Map<FunnelStep, Long>> sources = new LinkedHashMap<>();
        for (VisitSource source : VisitSource.values()) {
            if (bySource.containsKey(source.key())) {
                sources.put(source.key(), bySource.get(source.key()));
            }
        }
        Map<String, Map<FunnelStep, Long>> total = table(rows, r -> "total");
        StringBuilder text = new StringBuilder("<b>Visits</b>, last " + days + " d\n<pre>");
        header(text, "day", steps);
        byDay.forEach((day, counts) -> line(text, day, steps, counts));
        total.forEach((label, counts) -> line(text, label, steps, counts));
        text.append("</pre>\n<b>By source</b>\n<pre>");
        header(text, "", steps);
        sources.forEach((source, counts) -> line(text, source, steps, counts));
        text.append("</pre>Days in UTC. One hit per page a minute from one address; nothing about visitors is stored.");
        return text.toString();
    }

    private static Map<String, Map<FunnelStep, Long>> table(List<VisitCount> rows, Function<VisitCount, String> key) {
        Map<String, Map<FunnelStep, Long>> table = new TreeMap<>();
        for (VisitCount row : rows) {
            table.computeIfAbsent(key.apply(row), k -> new EnumMap<>(FunnelStep.class)).merge(row.step(), row.count(), Long::sum);
        }
        return table;
    }

    private static void header(StringBuilder text, String first, List<FunnelStep> steps) {
        text.append(String.format(Locale.ROOT, "%-8s", first));
        steps.forEach(step -> text.append(String.format(Locale.ROOT, "%5s", step.label())));
        text.append('\n');
    }

    private static void line(StringBuilder text, String label, List<FunnelStep> steps, Map<FunnelStep, Long> counts) {
        text.append(String.format(Locale.ROOT, "%-8s", label));
        steps.forEach(step -> text.append(String.format(Locale.ROOT, "%5d", counts.getOrDefault(step, 0L))));
        text.append('\n');
    }
}
