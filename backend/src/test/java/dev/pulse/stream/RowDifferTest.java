package dev.pulse.stream;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import dev.pulse.market.SymbolMetrics;
import tools.jackson.databind.json.JsonMapper;

class RowDifferTest {

    /** Every component of SymbolMetrics. */
    private static final int FIELDS = SymbolMetrics.class.getRecordComponents().length;

    private final RowDiffer differ = new RowDiffer(JsonMapper.builder().build(), 3);

    @Test
    void firstSightSendsTheWholeRowThenOnlyChanges() {
        assertThat(differ.diff(List.of(row(1.00, 0.0100))).getFirst()).hasSize(FIELDS);

        Map<String, Object> partial = differ.diff(List.of(row(1.01, 0.0100))).getFirst();

        assertThat(partial).containsOnlyKeys("symbol", "price").containsEntry("price", 1.01);
    }

    @Test
    void unchangedRowsAreDroppedAndKeyframesResendEverything() {
        differ.diff(List.of(row(1.00, 0.01)));

        assertThat(differ.diff(List.of(row(1.00, 0.01)))).as("tick 2, nothing changed").isEmpty();
        assertThat(differ.diff(List.of(row(1.00, 0.01)))).as("tick 3 is a keyframe").singleElement()
                .satisfies(full -> assertThat(full).hasSize(FIELDS));
    }

    @Test
    void aValueBecomingUnknownIsSentAsNull() {
        differ.diff(List.of(row(1.00, 0.01)));

        Map<String, Object> partial = differ.diff(List.of(row(1.00, null))).getFirst();

        assertThat(partial).containsOnlyKeys("symbol", "funding").containsEntry("funding", null);
    }

    private static SymbolMetrics row(double price, Double funding) {
        return new SymbolMetrics("WIFUSDT", price, 0.1, 0.2, 0.3, 0.4, 9.6, 1.1, 0.9, 1e9, 1.2, 1.4, funding,
                1L, 4e8, 1.5, 0);
    }
}
