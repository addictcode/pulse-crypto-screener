# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
# not /app: the terminal lives in an app/ folder and Vite then drops the root index.html
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Caddy serves the built app and proxies the backend, with automatic HTTPS.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /srv
