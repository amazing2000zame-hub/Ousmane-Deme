# Production stage — serves pre-built React app with nginx
# Build is done on the host (npm ci && npm run build) due to AppArmor blocking
# child_process.spawn in Docker builds on this Proxmox kernel.
FROM nginx:alpine

# Copy custom nginx config (includes API/WebSocket reverse proxy)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy pre-built assets
COPY dist/ /usr/share/nginx/html/

# Copy favicon
COPY public/jarvis-icon.svg /usr/share/nginx/html/jarvis-icon.svg

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider -q http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
