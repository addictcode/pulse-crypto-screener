package dev.pulse.stream;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonProperty;

import dev.pulse.market.Liquidation;
import dev.pulse.market.SymbolMetrics;

/**
 * Messages pushed to the browser over {@code /ws/market}. Each one carries a {@code type}
 * so the client can switch on it.
 */
public sealed interface StreamMessage {

    /** Full table, sent once right after a client connects. */
    record Snapshot(long ts, List<SymbolMetrics> rows, List<Liquidation> liquidations) implements StreamMessage {
        @JsonProperty
        public String type() {
            return "snapshot";
        }
    }

    /** Only the rows that changed since the previous tick. */
    record Delta(long ts, List<SymbolMetrics> rows) implements StreamMessage {
        @JsonProperty
        public String type() {
            return "delta";
        }
    }

    record Liquidations(List<Liquidation> items) implements StreamMessage {
        @JsonProperty
        public String type() {
            return "liquidations";
        }
    }

    /** 2h sparklines change slowly, so they travel separately and rarely. */
    record Sparklines(Map<String, List<Double>> series) implements StreamMessage {
        @JsonProperty
        public String type() {
            return "sparklines";
        }
    }
}
