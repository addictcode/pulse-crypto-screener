#!/usr/bin/env bash
# Runs setup.sh in a fresh Ubuntu 24.04 container the way an Oracle instance would, twice (it must
# be safe to repeat), and checks what it left behind. Docker, swap and systemd are not available
# in a container, so the stack is not started (PULSE_START=0); everything else is real: packages,
# Oracle's iptables rules, the user, SSH settings, automatic updates, .env.
#   deploy/oracle/test-in-docker.sh
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
docker run --rm --privileged -v "$root:/src:ro" ubuntu:24.04 bash -euo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q >/dev/null
  apt-get install -y -q iptables cloud-init >/dev/null

  echo "== cloud-init.yaml is valid cloud-config"
  cloud-init schema --config-file /src/deploy/oracle/cloud-init.yaml

  # what an Oracle Ubuntu image comes with: these rules, and the console key for "ubuntu"
  install -d /etc/iptables
  cat > /etc/iptables/rules.v4 <<RULES
*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
-A INPUT -p icmp -j ACCEPT
-A INPUT -i lo -j ACCEPT
-A INPUT -p udp --sport 123 -j ACCEPT
-A INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT
-A INPUT -j REJECT --reject-with icmp-host-prohibited
-A FORWARD -j REJECT --reject-with icmp-host-prohibited
COMMIT
RULES
  iptables-restore < /etc/iptables/rules.v4
  id ubuntu >/dev/null 2>&1 || useradd -m ubuntu
  install -d -m 700 /home/ubuntu/.ssh
  echo "ssh-ed25519 AAAATESTKEY owner@laptop" > /home/ubuntu/.ssh/authorized_keys

  # the repository as cloud-init clones it, from this checkout (CI checks out a detached commit,
  # so no --branch here)
  apt-get install -y -q git >/dev/null
  git config --global --add safe.directory "*"
  git clone -q /src /opt/pulse
  install -d /etc/pulse
  printf "PULSE_DOMAIN=test.duckdns.org\nDUCKDNS_TOKEN=\nREPO=https://github.com/AddictCode/pulse-crypto-screener.git\nBRANCH=unused\n" > /etc/pulse/install.env

  for run in 1 2; do
    echo "== setup.sh, run $run"
    PULSE_START=0 bash /src/deploy/oracle/setup.sh > /tmp/setup-$run.log 2>&1 || { cat /tmp/setup-$run.log; exit 1; }
  done

  fail() { echo "FAIL: $*"; exit 1; }
  echo "== checks"
  for p in "tcp 80" "tcp 443" "udp 443"; do
    set -- $p
    line="-A INPUT -p $1 -m state --state NEW -m $1 --dport $2 -j ACCEPT"
    [ "$(grep -cF -- "$line" /etc/iptables/rules.v4)" = 1 ] || fail "$1/$2 not exactly once in rules.v4"
    awk -v l="$line" "\$0 == l { a = NR } /^-A INPUT -j REJECT/ { r = NR } END { exit !(a && a < r) }" /etc/iptables/rules.v4 || fail "$1/$2 not before the reject"
    [ "$(iptables -S INPUT | grep -cF -- "--dport $2 -j ACCEPT" | head -1)" -ge 1 ] || fail "$1/$2 not live"
  done
  iptables -S INPUT | awk "/--dport 443 -j ACCEPT/ { a = NR } /-j REJECT/ { r = NR } END { exit !(a && a < r) }" || fail "live 443 after the reject"
  iptables-restore --test < /etc/iptables/rules.v4 || fail "rules.v4 does not load"
  id -nG pulse | grep -qw docker || fail "pulse is not in the docker group"
  grep -q AAAATESTKEY /home/pulse/.ssh/authorized_keys || fail "the console key does not reach pulse"
  [ "$(wc -l < /home/pulse/.ssh/authorized_keys)" = 1 ] || fail "keys doubled on the second run"
  [ "$(stat -c %a /home/pulse/.ssh/authorized_keys)" = 600 ] || fail "authorized_keys mode"
  grep -q "^PasswordAuthentication no" /etc/ssh/sshd_config.d/60-pulse.conf || fail "password login"
  grep -q "Unattended-Upgrade \"1\"" /etc/apt/apt.conf.d/20auto-upgrades || fail "automatic updates"
  dpkg -s unattended-upgrades docker.io docker-compose-v2 iptables-persistent >/dev/null || fail "packages"
  [ -d /opt/pulse/.git ] || fail "no clone"
  [ "$(stat -c %U /opt/pulse/.env)" = pulse ] && [ "$(stat -c %a /opt/pulse/.env)" = 600 ] || fail ".env owner or mode"
  grep -q "^PULSE_DOMAIN=test.duckdns.org$" /opt/pulse/.env || fail "domain not in .env"
  grep -Eq "^POSTGRES_PASSWORD=[0-9a-f]{48}$" /opt/pulse/.env || fail "no database password"
  [ "$(grep -c "^PULSE_BACKEND_IMAGE=ghcr.io/addictcode/pulse-backend$" /opt/pulse/.env)" = 1 ] || fail "ready images not set exactly once"
  [ "$(grep -c backup.sh /etc/cron.d/pulse-backup)" = 1 ] || fail "nightly backup not exactly once"
  [ "$(grep -c restore-check.sh /etc/cron.d/pulse-restore-check)" = 1 ] || fail "weekly restore check not exactly once"
  [ -x /opt/pulse/deploy/backup.sh ] || fail "backup.sh not executable in the clone"
  [ "$(grep -c heartbeat.sh /etc/cron.d/pulse-heartbeat)" = 1 ] || fail "heartbeat not exactly once"
  [ -x /opt/pulse/deploy/heartbeat.sh ] || fail "heartbeat.sh not executable in the clone"
  echo "all checks passed"
'
