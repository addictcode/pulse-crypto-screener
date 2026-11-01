# The web image of compose.prod.yaml from a build made outside Docker (run.sh does it).
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY dist /srv
