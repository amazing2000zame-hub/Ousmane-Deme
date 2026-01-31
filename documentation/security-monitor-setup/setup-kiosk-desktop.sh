#!/bin/bash
set -e

echo "======================================================="
echo "Setting up Kiosk Mode for Ubuntu Desktop"
echo "======================================================="
echo ""

# Install unclutter to hide mouse cursor
echo "Installing unclutter to hide mouse cursor..."
sudo apt update
sudo apt install -y unclutter chromium-browser

# Create autostart directory
echo "Creating autostart directory..."
mkdir -p ~/.config/autostart

# Disable screen blanking and sleep via GNOME settings
echo "Disabling screen blanking and sleep..."
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.desktop.screensaver idle-activation-enabled false
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing'

# Hide cursor when idle
echo "Creating unclutter autostart entry..."
cat > ~/.config/autostart/unclutter.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=Unclutter
Exec=unclutter -idle 0.5 -root
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

# Create startup script for Home Assistant kiosk
echo "Creating kiosk startup script..."
mkdir -p ~/.local/bin
cat > ~/.local/bin/start-security-monitor.sh << 'EOF'
#!/bin/bash

# Wait for network and Docker to be ready
sleep 15

# Wait for Home Assistant to be ready (max 2 minutes)
echo "Waiting for Home Assistant to start..."
for i in {1..24}; do
    if curl -s http://localhost:8123 > /dev/null 2>&1; then
        echo "Home Assistant is ready!"
        break
    fi
    echo "Waiting... ($i/24)"
    sleep 5
done

# Launch Chromium in kiosk mode
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --no-first-run \
  --disable-default-apps \
  --disable-popup-blocking \
  --app=http://localhost:8123
EOF

chmod +x ~/.local/bin/start-security-monitor.sh

# Create autostart entry for the kiosk
echo "Creating kiosk autostart entry..."
cat > ~/.config/autostart/security-monitor-kiosk.desktop << EOF
[Desktop Entry]
Type=Application
Name=Security Monitor Kiosk
Comment=Auto-start Home Assistant in kiosk mode
Exec=$HOME/.local/bin/start-security-monitor.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

# Disable GNOME initial setup if not done
if [ -f /usr/bin/gnome-initial-setup ]; then
    sudo systemctl disable gnome-initial-setup.service 2>/dev/null || true
fi

# Set shorter GRUB timeout for faster boot
echo "Setting faster GRUB boot timeout..."
if grep -q "GRUB_TIMEOUT=" /etc/default/grub; then
    sudo sed -i 's/GRUB_TIMEOUT=.*/GRUB_TIMEOUT=2/' /etc/default/grub
    sudo update-grub
fi

echo ""
echo "======================================================="
echo "Ubuntu Desktop Kiosk Mode Setup Complete!"
echo "======================================================="
echo ""
echo "Configuration applied:"
echo "  ✓ Screen blanking disabled"
echo "  ✓ Sleep disabled"
echo "  ✓ Mouse cursor auto-hide enabled"
echo "  ✓ Chromium kiosk mode will auto-start on login"
echo "  ✓ GRUB boot timeout reduced to 2 seconds"
echo ""
echo "To activate kiosk mode:"
echo "  1. Reboot: sudo reboot"
echo "  2. System will auto-login and launch Home Assistant fullscreen"
echo ""
echo "To exit kiosk mode:"
echo "  - Press F11 to exit fullscreen"
echo "  - Press Alt+F4 to close browser"
echo ""
echo "To disable kiosk mode:"
echo "  - Remove: ~/.config/autostart/security-monitor-kiosk.desktop"
echo ""
