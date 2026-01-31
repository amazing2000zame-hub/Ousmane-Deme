#!/bin/bash
set -e

echo "======================================"
echo "Setting up Kiosk Mode for Monitor"
echo "======================================"

# Install X server and lightweight desktop
echo "Installing X server and Openbox..."
sudo apt install -y xorg openbox chromium-browser unclutter x11-xserver-utils

# Create openbox config directory
echo "Creating Openbox configuration..."
mkdir -p ~/.config/openbox

# Create autostart script
cat > ~/.config/openbox/autostart << 'EOF'
# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Hide cursor when idle
unclutter -idle 0.1 &

# Wait for Home Assistant to be ready
sleep 10

# Start Chromium in kiosk mode pointing to Home Assistant
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --app=http://localhost:8123
EOF

chmod +x ~/.config/openbox/autostart

# Configure auto-login on tty1
echo "Configuring auto-login..."
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf > /dev/null << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $USER --noclear %I \$TERM
EOF

# Add startx to bash profile to auto-start X on login
if ! grep -q "startx" ~/.bash_profile 2>/dev/null; then
    echo "Configuring auto-start of X server..."
    cat >> ~/.bash_profile << 'EOF'

# Auto-start X server on tty1
if [[ -z $DISPLAY ]] && [[ $(tty) = /dev/tty1 ]]; then
    exec startx -- -nocursor
fi
EOF
fi

# Create xinitrc to start openbox
cat > ~/.xinitrc << 'EOF'
#!/bin/sh
exec openbox-session
EOF

chmod +x ~/.xinitrc

echo ""
echo "======================================"
echo "Kiosk mode setup complete!"
echo "======================================"
echo "The system will auto-login and launch Home Assistant in fullscreen mode"
echo "To exit kiosk mode, press Alt+F4"
echo ""
