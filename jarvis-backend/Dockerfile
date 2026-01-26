# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies without post-install scripts (avoids seccomp issues on Proxmox)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Download pre-built better-sqlite3 binary for this platform
RUN npx --yes prebuild-install --runtime napi --target 9 -d node_modules/better-sqlite3 || \
    echo "WARN: prebuild-install failed, better-sqlite3 will need host-built binary"

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:22-slim

WORKDIR /app

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create SSH directory for cluster access and data directory
RUN mkdir -p /app/.ssh && chmod 700 /app/.ssh
RUN mkdir -p /data

EXPOSE 4000

CMD ["node", "dist/index.js"]
