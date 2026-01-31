#!/bin/bash
set -e

echo "=========================================="
echo "Security Monitor VM - Master Setup Script"
echo "=========================================="
echo ""
echo "This script will:"
echo "1. Install Docker and Docker Compose"
echo "2. Set up Home Assistant and Scrypted"
echo "3. Configure kiosk mode for the monitor"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Step 1: Install Docker
echo ""
echo "Step 1: Installing Docker..."
bash install-docker.sh

# Step 2: Create home directory structure
echo ""
echo "Step 2: Creating application directories..."
mkdir -p ~/security-system
cp docker-compose.yml ~/security-system/
cd ~/security-system

# Step 3: Start containers
echo ""
echo "Step 3: Starting Home Assistant and Scrypted containers..."
docker-compose up -d

echo ""
echo "Waiting for containers to initialize (30 seconds)..."
sleep 30

# Check container status
echo ""
echo "Container status:"
docker-compose ps

# Step 4: Setup kiosk mode
echo ""
read -p "Do you want to set up kiosk mode for the monitor? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$SCRIPT_DIR"

    # Detect if running Ubuntu Desktop (GNOME)
    if [ -n "$XDG_CURRENT_DESKTOP" ] && [ "$XDG_CURRENT_DESKTOP" = "ubuntu:GNOME" ]; then
        echo "Detected Ubuntu Desktop - using desktop kiosk setup..."
        bash setup-kiosk-desktop.sh
    elif command -v gnome-shell &> /dev/null; then
        echo "Detected GNOME Desktop - using desktop kiosk setup..."
        bash setup-kiosk-desktop.sh
    else
        echo "Detected server environment - using minimal kiosk setup..."
        bash setup-kiosk.sh
    fi
fi

# Get VM IP address
VM_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Home Assistant: http://$VM_IP:8123"
echo "Scrypted:       http://$VM_IP:10443"
echo ""
echo "Next steps:"
echo "1. Open Home Assistant at http://$VM_IP:8123 and complete initial setup"
echo "2. Open Scrypted at http://$VM_IP:10443 and complete initial setup"
echo "3. In Scrypted, install the Ring plugin:"
echo "   - Go to Plugins -> Add New Plugin"
echo "   - Search for 'Ring'"
echo "   - Install and enter your Ring credentials"
echo "4. In Home Assistant, add the Scrypted integration:"
echo "   - Settings -> Devices & Services -> Add Integration"
echo "   - Search for 'Scrypted'"
echo "   - Enter URL: http://localhost:10443"
echo ""
echo "If you enabled kiosk mode, reboot the VM to activate it:"
echo "  sudo reboot"
echo ""
echo "=========================================="
