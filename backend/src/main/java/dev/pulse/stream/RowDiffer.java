package dev.pulse.stream;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import dev.pulse.market.SymbolMetrics;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Turns full rows into field-level changes. Most ticks only move the price and the price-based
 * columns; funding, open interest or NATR change rarely, so sending them every tick is waste.
 * <p>
 * Every {@code keyframeEvery} ticks whole rows go out again, the way video codecs send keyframes:
 * a client that connected between two ticks, or a field that changed and changed back unseen,
 * can never drift for long. Not thread safe: only the broadcaster thread uses it.
 */
final class RowDiffer {

    private static final TypeReference<LinkedHashMap<String, Object>> ROW = new TypeReference<>() { };

    private final JsonMapper mapper;
    private final int keyframeEvery;
    private final Map<String, Map<String, Object>> lastSent = new HashMap<>();
    private int tick;

    RowDiffer(JsonMapper mapper, int keyframeEvery) {
        this.mapper = mapper;
        this.keyframeEvery = keyframeEvery;
    }

    /** Partial rows: always the symbol, plus every field that differs from what was sent last. */
    List<Map<String, Object>> diff(List<SymbolMetrics> rows) {
        boolean keyframe = ++tick % keyframeEvery == 0;
        return rows.stream()
                .map(row -> diff(row, keyframe))
                .filter(partial -> partial.size() > 1)
                .toList();
    }

    private Map<String, Object> diff(SymbolMetrics row, boolean keyframe) {
        Map<String, Object> current = mapper.convertValue(row, ROW);
        Map<String, Object> previous = lastSent.put(row.symbol(), current);
        if (previous == null || keyframe) {
            return current;
        }
        Map<String, Object> changed = new LinkedHashMap<>();
        changed.put("symbol", row.symbol());
        current.forEach((field, value) -> {
            if (!Objects.equals(value, previous.get(field))) {
                changed.put(field, value);
            }
        });
        return changed;
    }
}
