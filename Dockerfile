FROM node:22-alpine

WORKDIR /app

# Install curl for healthcheck and pnpm
RUN apk add --no-cache curl && corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy signaling server code
COPY signaling-server.js ./
COPY ecosystem.config.js ./

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start signaling server
CMD ["node", "signaling-server.js"]