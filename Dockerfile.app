# Web app (SvelteKit, adapter-node). Multi-stage: build, then a slim runtime.
#
# The signaling origin is baked in at BUILD time: svelte.config.js pins the CSP
# `connect-src` to it, so the browser will only open the signaling WebSocket to
# this exact origin. Set it to the address the *browser* reaches signaling at
# (ws://localhost:9210 for the localhost quickstart, or wss://signal.example.com
# for a real domain) — NOT the compose-internal hostname. Changing it needs a
# rebuild (`--build`).

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_SIGNALING_SERVER=ws://localhost:9210
ARG VITE_TURN_URLS=
ARG VITE_TURN_USERNAME=
ARG VITE_TURN_CREDENTIAL=
ENV NODE_ENV=production
RUN pnpm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache curl && corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/build ./build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1
CMD ["node", "build"]
