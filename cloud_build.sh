#!/bin/bash
set -ex

# Build frontend bundle
pnpm run build:cloudflare

# Inject environment variables
node scripts/inject-env.js
