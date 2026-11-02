package dev.pulse.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class ClientAddressTest {

    @Test
    void ipv4IsTakenAsItIs() {
        assertThat(ClientAddress.network("203.0.113.7")).isEqualTo("203.0.113.7");
    }

    @Test
    void everyAddressOfOneIpv6NetworkIsOneClient() {
        assertThat(ClientAddress.network("2001:db8:0:1::1")).isEqualTo("2001:db8:0:1::/64");
        assertThat(ClientAddress.network("2001:db8:0:1:ffff:ffff:ffff:ffff")).isEqualTo("2001:db8:0:1::/64");
        assertThat(ClientAddress.network("2001:DB8:0:2::1")).isEqualTo("2001:db8:0:2::/64");
    }

    @Test
    void anIpv4MappedAddressIsItsIpv4() {
        assertThat(ClientAddress.network("::ffff:203.0.113.7")).isEqualTo("203.0.113.7");
    }

    @Test
    void somethingThatIsNotAnAddressIsKeptAsItIs() {
        assertThat(ClientAddress.network("not:an:address:at:all:zz")).isEqualTo("not:an:address:at:all:zz");
        assertThat(ClientAddress.network("null")).isEqualTo("null");
    }

    @Test
    void theHeaderFromCaddyWinsOverTheSocket() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("172.18.0.5");
        request.addHeader(ClientAddress.HEADER, " 2001:db8:0:1::abcd ");
        assertThat(ClientAddress.of(request)).isEqualTo("2001:db8:0:1::/64");

        assertThat(ClientAddress.of(new MockHttpServletRequest())).isEqualTo("127.0.0.1");
    }
}
