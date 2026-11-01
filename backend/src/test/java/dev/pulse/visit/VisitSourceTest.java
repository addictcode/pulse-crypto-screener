package dev.pulse.visit;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class VisitSourceTest {

    @Test
    void foldsWhatPagesKnowIntoAFewBuckets() {
        assertThat(VisitSource.of("tiktok")).isEqualTo(VisitSource.TIKTOK);
        assertThat(VisitSource.of("www.tiktok.com")).isEqualTo(VisitSource.TIKTOK);
        assertThat(VisitSource.of("vm.tiktok.com")).isEqualTo(VisitSource.TIKTOK);
        assertThat(VisitSource.of("t.me")).isEqualTo(VisitSource.TELEGRAM);
        assertThat(VisitSource.of("web.telegram.org")).isEqualTo(VisitSource.TELEGRAM);
        assertThat(VisitSource.of("tg")).isEqualTo(VisitSource.TELEGRAM);
        assertThat(VisitSource.of("www.google.com")).isEqualTo(VisitSource.GOOGLE);
        assertThat(VisitSource.of("Google")).isEqualTo(VisitSource.GOOGLE);
    }

    @Test
    void nothingIsDirectAndAnythingElseIsOther() {
        assertThat(VisitSource.of(null)).isEqualTo(VisitSource.DIRECT);
        assertThat(VisitSource.of("  ")).isEqualTo(VisitSource.DIRECT);
        assertThat(VisitSource.of("site")).isEqualTo(VisitSource.DIRECT);
        assertThat(VisitSource.of("www.reddit.com")).isEqualTo(VisitSource.OTHER);
        assertThat(VisitSource.of("<script>")).isEqualTo(VisitSource.OTHER);
    }
}
