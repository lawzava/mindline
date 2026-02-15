#!/bin/bash
set -ex

# Install Rust toolchain
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"

# Build WASM module
wasm-pack build --target web

# Build frontend bundle
pnpm run build:cloudflare

# Inject environment variables
node scripts/inject-env.js
