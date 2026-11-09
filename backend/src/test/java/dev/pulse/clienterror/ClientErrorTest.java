package dev.pulse.clienterror;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ClientErrorTest {

    @Test
    void theAddressQueryAndFragmentDoNotReachTheDatabase() {
        ClientError e = ClientError.of("boom", "", "https://pulse.example/app/?utm_source=tiktok#screener:BTCUSDT", "abc", "RU");
        assertThat(e.page()).isEqualTo("/app/");
        assertThat(e.lang()).isEqualTo("ru");
    }

    @Test
    void longTextIsCut() {
        ClientError e = ClientError.of("x".repeat(5_000), "y".repeat(50_000), "/", "b".repeat(100), "en-US-x");
        assertThat(e.message()).hasSize(ClientError.MESSAGE);
        assertThat(e.stack()).hasSize(ClientError.STACK);
        assertThat(e.build()).hasSize(ClientError.BUILD);
        assertThat(e.lang()).hasSize(ClientError.LANG);
    }

    @Test
    void theSameErrorFromAnotherBuildOrPositionHasTheSameFingerprint() {
        ClientError a = ClientError.of("Cannot read properties of undefined (reading 'price')",
                "TypeError: Cannot read properties of undefined (reading 'price')\n    at render (/assets/main-B4x9_kQ1.js:12:3456)", "/app/", "b1", "en");
        ClientError b = ClientError.of("Cannot read properties of undefined (reading 'price')",
                "TypeError: Cannot read properties of undefined (reading 'price')\n    at render (/assets/main-Zz81aPq0.js:13:99)", "/app/", "b2", "ru");
        ClientError other = ClientError.of("Cannot read properties of undefined (reading 'price')",
                "TypeError: ...\n    at draw (/assets/chart-Zz81aPq0.js:1:1)", "/app/", "b2", "ru");
        assertThat(a.fingerprint()).isEqualTo(b.fingerprint()).isNotEqualTo(other.fingerprint());
    }

    @Test
    void anEmptyMessageStillMakesARow() {
        assertThat(ClientError.of(" ", null, null, null, null).message()).isEqualTo("(no message)");
    }
}
