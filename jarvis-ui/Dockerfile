# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Accept backend URL as build arg (empty = same-origin via nginx proxy)
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

# Install dependencies deterministically
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files and build
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config (includes API/WebSocket reverse proxy)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy favicon
COPY public/jarvis-icon.svg /usr/share/nginx/html/jarvis-icon.svg

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider -q http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
