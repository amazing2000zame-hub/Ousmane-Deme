#!/bin/bash
# =============================================================================
# Jarvis 3.1 Deployment Script
# Deploys full stack to management VM (192.168.1.65)
# Run from Home node: ./deploy.sh
# =============================================================================

set -euo pipefail

MANAGEMENT_VM="root@192.168.1.65"
DEPLOY_DIR="/opt/jarvis"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  JARVIS 3.1 Deployment"
echo "============================================"
echo ""

# 1. Validate required files
echo "[1/5] Validating project structure..."
for f in docker-compose.yml jarvis-backend/Dockerfile jarvis-backend/package.json jarvis-ui/Dockerfile jarvis-ui/package.json; do
  if [ ! -f "$PROJECT_ROOT/$f" ]; then
    echo "ERROR: Missing required file: $f"
    exit 1
  fi
done
echo "  Project structure validated."

# 2. Check management VM is reachable
echo "[2/5] Checking management VM connectivity..."
if ! ssh -o ConnectTimeout=5 "$MANAGEMENT_VM" "echo ok" >/dev/null 2>&1; then
  echo "ERROR: Cannot reach $MANAGEMENT_VM"
  echo "  Ensure the management VM is running and SSH access is configured."
  exit 1
fi
echo "  Management VM is reachable."

# 3. Sync project files to management VM
echo "[3/5] Syncing project files to $MANAGEMENT_VM:$DEPLOY_DIR ..."
ssh "$MANAGEMENT_VM" "mkdir -p $DEPLOY_DIR"

rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='jarvis-ui/dist' \
  --exclude='jarvis-ui/node_modules' \
  --exclude='jarvis-backend/dist' \
  --exclude='jarvis-backend/node_modules' \
  --exclude='jarvis-backend/data' \
  --exclude='.planning' \
  --exclude='.claude' \
  --exclude='documentation' \
  --exclude='cluster-plans' \
  --exclude='proxmox-ui' \
  --exclude='jarvis-v3' \
  --exclude='telegram-uploads' \
  --exclude='.cache' \
  --exclude='.npm' \
  --exclude='.local' \
  "$PROJECT_ROOT/docker-compose.yml" \
  "$PROJECT_ROOT/jarvis-backend" \
  "$PROJECT_ROOT/jarvis-ui" \
  "$MANAGEMENT_VM:$DEPLOY_DIR/"

# Copy .env if it exists (for secrets)
if [ -f "$PROJECT_ROOT/jarvis-backend/.env" ]; then
  scp -q "$PROJECT_ROOT/jarvis-backend/.env" "$MANAGEMENT_VM:$DEPLOY_DIR/.env"
  echo "  .env file copied."
fi

echo "  Files synced."

# 4. Build and deploy containers
echo "[4/5] Building and deploying containers..."
ssh "$MANAGEMENT_VM" "cd $DEPLOY_DIR && docker compose up -d --build 2>&1"
echo "  Containers deployed."

# 5. Wait for health checks
echo "[5/5] Waiting for health checks..."
MAX_WAIT=60
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  BACKEND_OK=$(ssh "$MANAGEMENT_VM" "wget -qO- http://localhost:4000/api/health 2>/dev/null" || echo "")
  FRONTEND_OK=$(ssh "$MANAGEMENT_VM" "wget -qO- http://localhost:3004/health 2>/dev/null" || echo "")

  if [ -n "$BACKEND_OK" ] && [ -n "$FRONTEND_OK" ]; then
    echo ""
    echo "============================================"
    echo "  DEPLOYMENT SUCCESSFUL"
    echo "============================================"
    echo ""
    echo "  Backend:  http://192.168.1.65:4000"
    echo "  Frontend: http://192.168.1.65:3004"
    echo "  Health:   http://192.168.1.65:4000/api/health"
    echo ""
    exit 0
  fi

  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo "  Waiting... ($ELAPSED/${MAX_WAIT}s)"
done

echo ""
echo "WARNING: Health checks did not pass within ${MAX_WAIT}s."
echo "  Check container logs: ssh $MANAGEMENT_VM 'cd $DEPLOY_DIR && docker compose logs'"
exit 1
