package dev.pulse.setup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import dev.pulse.market.Candle;
import dev.pulse.market.Positioning;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class SetupRulesTest {

    /**
     * Real candles and open interest on which the web client's strategy enters on the last
     * candle, with the plan it made. The server must make the same one, to the last digit that
     * floating point allows: the chart and the journal describe the same trade.
     */
    @Test
    void agreesWithTheWebClientOnRealCases() throws IOException {
        JsonNode cases;
        try (InputStream in = getClass().getResourceAsStream("/setup/web-client-cases.json")) {
            cases = new ObjectMapper().readTree(in);
        }
        assertThat(cases.size()).isEqualTo(2);
        for (JsonNode c : cases) {
            Optional<SetupPlan> plan = SetupRules.planFor(bars(c), points(c.get("openInterest")), c.get("step").asLong());

            assertThat(plan).as(c.get("symbol").asString()).isPresent();
            assertThat(plan.get().direction()).isEqualTo(c.get("direction").asInt());
            assertThat(plan.get().entry()).isEqualTo(c.get("entry").asDouble());
            assertThat(plan.get().stop()).isCloseTo(c.get("stop").asDouble(), within(1e-9 * plan.get().entry()));
            assertThat(plan.get().target()).isCloseTo(c.get("target").asDouble(), within(1e-9 * plan.get().entry()));
        }
    }

    @Test
    void aBreakoutNobodyOpensPositionsIntoIsNotTaken() throws IOException {
        JsonNode c;
        try (InputStream in = getClass().getResourceAsStream("/setup/web-client-cases.json")) {
            c = new ObjectMapper().readTree(in).get(0);
        }
        List<Positioning.Point> flat = points(c.get("openInterest")).stream().map(p -> new Positioning.Point(p.time(), 1e9)).toList();

        assertThat(SetupRules.planFor(bars(c), flat, c.get("step").asLong())).isEmpty();
        assertThat(SetupRules.planFor(bars(c), List.of(), c.get("step").asLong())).isEmpty();
    }

    @Test
    void needsEnoughHistoryForTheSlowAverage() throws IOException {
        JsonNode c;
        try (InputStream in = getClass().getResourceAsStream("/setup/web-client-cases.json")) {
            c = new ObjectMapper().readTree(in).get(0);
        }
        List<Candle> all = bars(c);

        assertThat(SetupRules.planFor(all.subList(all.size() - 100, all.size()), points(c.get("openInterest")), 3_600)).isEmpty();
    }

    @Test
    void theTargetIsThreeStopsAwayAndFeesComeOffTheResult() {
        SetupPlan plan = new SetupPlan(1, 100, 99, 103);

        // 1% of price is risked, so 0.05% a side costs 0.1R
        assertThat(SetupRules.resultR(plan, 103)).isCloseTo(2.9, within(1e-9));
        assertThat(SetupRules.resultR(plan, 99)).isCloseTo(-1.1, within(1e-9));
        assertThat(SetupRules.resultR(new SetupPlan(-1, 100, 101, 97), 97)).isCloseTo(2.9, within(1e-9));
    }

    private static List<Candle> bars(JsonNode c) {
        List<Candle> bars = new ArrayList<>();
        for (JsonNode b : c.get("bars")) {
            bars.add(new Candle(b.get(0).asLong() * 1000, b.get(1).asDouble(), b.get(2).asDouble(), b.get(3).asDouble(), b.get(4).asDouble(),
                    b.get(5).asDouble(), true));
        }
        return bars;
    }

    private static List<Positioning.Point> points(JsonNode array) {
        List<Positioning.Point> points = new ArrayList<>();
        for (JsonNode p : array) {
            points.add(new Positioning.Point(p.get(0).asLong(), p.get(1).asDouble()));
        }
        return points;
    }
}
