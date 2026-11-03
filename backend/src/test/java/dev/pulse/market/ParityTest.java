package dev.pulse.market;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import dev.pulse.depth.BookView;
import dev.pulse.depth.WallDetector;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The demo on GitHub Pages computes the market in the browser with a copy of these calculations
 * (web/src/lite). Both sides run the same inputs from web/src/lite/parity.json; this side is the
 * reference and wrote the expected values there, web/src/lite/parity.test.ts checks the copy
 * against them. A change here that is meant shows up as this test failing: then rewrite the
 * expected values and update the copy until its test passes too:
 *
 * <pre>PULSE_PARITY_WRITE=1 ./gradlew test --tests dev.pulse.market.ParityTest</pre>
 */
class ParityTest {

    static final Path FIXTURE = Path.of("../web/src/lite/parity.json");
    static final int[] CHANGE_MINUTES = {1, 5, 15, 60, 180, 181};

    private final JsonMapper mapper = JsonMapper.builder().enable(SerializationFeature.INDENT_OUTPUT).build();

    @Test
    void theBrowserCopyHasTheServersAnswers() throws Exception {
        ObjectNode fixture = (ObjectNode) mapper.readTree(Files.readString(FIXTURE));
        ObjectNode built = mapper.createObjectNode();
        built.set("metrics", metrics(fixture.path("metrics")));
        built.set("walls", walls(fixture.path("walls")));
        // through text and back: values put as objects become the same nodes the file reads into
        JsonNode computed = mapper.readTree(mapper.writeValueAsString(built));

        if ("1".equals(System.getenv("PULSE_PARITY_WRITE"))) {
            ((ObjectNode) fixture.get("metrics")).set("expected", computed.get("metrics"));
            ((ObjectNode) fixture.get("walls")).set("expected", computed.get("walls"));
            Files.writeString(FIXTURE, mapper.writeValueAsString(fixture) + "\n");
            return;
        }
        assertSame(computed.get("metrics"), fixture.path("metrics").path("expected"), "metrics");
        assertSame(computed.get("walls"), fixture.path("walls").path("expected"), "walls");
    }

    private ObjectNode metrics(JsonNode in) {
        List<Candle> candles = new ArrayList<>();
        for (JsonNode c : in.path("candles")) {
            candles.add(new Candle(c.path("openTime").asLong(), c.path("open").asDouble(), c.path("high").asDouble(),
                    c.path("low").asDouble(), c.path("close").asDouble(), c.path("quoteVolume").asDouble(), true));
        }
        List<OpenInterestPoint> oi = new ArrayList<>();
        for (JsonNode p : in.path("openInterest")) {
            oi.add(new OpenInterestPoint(p.path("time").asLong(), p.path("contracts").asDouble()));
        }
        double price = in.path("price").asDouble();

        ObjectNode out = mapper.createObjectNode();
        ObjectNode change = out.putObject("changePct");
        for (int minutes : CHANGE_MINUTES) {
            change.putPOJO(String.valueOf(minutes), MetricsCalculator.changePct(candles, price, minutes));
        }
        out.putPOJO("surge", MetricsCalculator.surge(candles));
        out.putPOJO("natr14", MetricsCalculator.natr(candles, 14));
        out.putPOJO("sparkline24", MetricsCalculator.sparkline(candles, 24));
        out.putPOJO("openInterestChangePct15", MetricsCalculator.openInterestChangePct(oi, in.path("now").asLong(), 15));
        ArrayNode buckets = out.putArray("buckets5");
        for (Candle b : MetricsCalculator.toBuckets(candles, 5)) {
            buckets.addObject().put("openTime", b.openTime()).put("open", b.open()).put("high", b.high())
                    .put("low", b.low()).put("close", b.close()).put("quoteVolume", b.quoteVolume());
        }
        return out;
    }

    private ArrayNode walls(JsonNode in) {
        double[][] bids = levels(in.path("bids"));
        double[][] asks = levels(in.path("asks"));
        double mid = (bids[0][0] + asks[0][0]) / 2;
        // as far as the snapshot reaches on its thinner side, the way the order book reports it
        double coverage = Math.min((mid - bids[0][bids[0].length - 1]) / mid * 100, (asks[0][asks[0].length - 1] - mid) / mid * 100);
        BookView view = new BookView("TESTUSDT", bids[0][0], asks[0][0], bids[0], bids[1], asks[0], asks[1], coverage);
        JsonNode p = in.path("params");
        WallDetector.Params params = new WallDetector.Params(p.path("bucketPct").asDouble(), p.path("multiple").asDouble(),
                p.path("minNotional").asDouble(), p.path("volumeShare").asDouble(), p.path("maxPerSide").asInt());
        double width = WallDetector.bucketWidth(mid, params.bucketPct());

        ArrayNode out = mapper.createArrayNode();
        for (WallDetector.Detected d : WallDetector.detect(view, width, in.path("volume24h").asDouble(), params)) {
            out.addObject().put("side", d.side().name()).put("bucket", d.bucket()).put("price", d.price())
                    .put("notional", d.notional()).put("multiple", d.multiple());
        }
        return out;
    }

    /** [prices, quantities] from [[price, quantity], ...]. */
    private static double[][] levels(JsonNode rows) {
        double[][] out = new double[2][rows.size()];
        for (int i = 0; i < rows.size(); i++) {
            out[0][i] = rows.get(i).get(0).asDouble();
            out[1][i] = rows.get(i).get(1).asDouble();
        }
        return out;
    }

    /** Same shape, same strings, numbers equal to a billionth of their size. */
    private static void assertSame(JsonNode actual, JsonNode expected, String path) {
        assertThat(expected.isMissingNode()).as(path + ": no expected values; write them first").isFalse();
        if (actual.isNumber() && expected.isNumber()) {
            double e = expected.asDouble();
            assertThat(actual.asDouble()).as(path).isCloseTo(e, within(Math.max(1e-9, Math.abs(e) * 1e-9)));
        } else if (actual.isObject()) {
            assertThat(actual.propertyNames()).as(path).containsExactlyInAnyOrderElementsOf(expected.propertyNames());
            for (Map.Entry<String, JsonNode> field : actual.properties()) {
                assertSame(field.getValue(), expected.get(field.getKey()), path + "." + field.getKey());
            }
        } else if (actual.isArray()) {
            assertThat(actual.size()).as(path + " size").isEqualTo(expected.size());
            for (int i = 0; i < actual.size(); i++) {
                assertSame(actual.get(i), expected.get(i), path + "[" + i + "]");
            }
        } else {
            assertThat(actual).as(path).isEqualTo(expected);
        }
    }
}
