#!/bin/bash
set -ex

# Install Rust toolchain
curl https://sh.rustup.rs -sSf | sh -s -- -y
source "$HOME/.cargo/env"

# Build WASM module
wasm-pack build --target web

# Build webpack bundle
npx webpack --mode production --env cloudflare=true

# Inject environment variables
node scripts/inject-env.js