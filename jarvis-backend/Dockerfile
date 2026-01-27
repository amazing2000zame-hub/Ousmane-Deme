# Single-stage production image
# Build is done on the host (npm ci && npm run build) due to AppArmor blocking
# child_process.spawn in Docker builds on this Proxmox kernel.
FROM node:22-slim

WORKDIR /app

# Install wget for healthcheck, ffmpeg for Opus encoding (Phase 23)
RUN apt-get update && apt-get install -y --no-install-recommends wget ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy pre-built artifacts from host
COPY dist ./dist
COPY node_modules ./node_modules
COPY package.json ./

# Create SSH directory for cluster access and data directory
RUN mkdir -p /app/.ssh && chmod 700 /app/.ssh
RUN mkdir -p /data

EXPOSE 4000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --spider -q http://localhost:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
