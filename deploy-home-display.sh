#!/bin/bash
# Phase 37 Plan 04: Deploy Home Node Display Control
# This script sets up the X11 kiosk session and display daemon on the Home node eDP-1
set -euo pipefail

echo "=== Phase 37-04: Home Node Display Setup ==="

# Part A: Create kiosk user
echo "[1/8] Creating kiosk user..."
if id kiosk &>/dev/null; then
    echo "  kiosk user already exists"
else
    useradd -r -s /usr/sbin/nologin -m -d /home/kiosk kiosk
    echo "  kiosk user created"
fi

# Part A: Create .xinitrc
echo "[2/8] Creating .xinitrc..."
cat > /home/kiosk/.xinitrc << 'XINITEOF'
#!/bin/bash
# Jarvis kiosk X11 session on eDP-1
export DISPLAY=:1
xsetroot -solid black 2>/dev/null
xset s off -dpms 2>/dev/null
exec openbox --config-file /dev/null
XINITEOF
chmod +x /home/kiosk/.xinitrc
chown kiosk:kiosk /home/kiosk/.xinitrc

# Part A: Create Xorg config for Intel GPU
echo "[3/8] Creating Xorg config for Intel GPU (PCI:0:2:0)..."
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-kiosk-edp.conf << 'XORGEOF'
Section "Device"
    Identifier "Intel"
    Driver "modesetting"
    BusID "PCI:0:2:0"
    Option "PrimaryGPU" "true"
EndSection

Section "Monitor"
    Identifier "eDP-1"
    Option "Enable" "true"
EndSection

Section "Screen"
    Identifier "KioskScreen"
    Device "Intel"
    Monitor "eDP-1"
EndSection

Section "ServerLayout"
    Identifier "KioskLayout"
    Screen "KioskScreen"
EndSection
XORGEOF

# Part A: Create kiosk systemd service
echo "[4/8] Creating kiosk-home.service..."
cat > /etc/systemd/system/kiosk-home.service << 'SVCEOF'
[Unit]
Description=Jarvis Kiosk X11 Session (Home eDP-1)
After=multi-user.target

[Service]
Type=simple
User=kiosk
Environment=HOME=/home/kiosk
ExecStart=/usr/bin/xinit /home/kiosk/.xinitrc -- /usr/bin/Xorg :1 vt8 -nolisten tcp -keeptty
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

# Part B: Install websockets for CDP
echo "[5/8] Installing python3-websockets..."
apt-get install -y -qq python3-websockets 2>/dev/null || pip3 install websockets 2>/dev/null || true

# Part B: Copy HUD from management VM
echo "[6/8] Copying HUD page from management VM..."
scp -o StrictHostKeyChecking=no root@192.168.1.65:/opt/jarvis-display/static/hud.html /opt/jarvis-display-home/static/hud.html 2>/dev/null || {
    echo "  scp failed, creating minimal HUD placeholder"
    cat > /opt/jarvis-display-home/static/hud.html << 'HUDEOF'
<!DOCTYPE html>
<html><head><title>JARVIS HUD</title>
<style>body{margin:0;background:#0a0a0f;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace}
h1{color:#00d4ff;font-size:4em;text-shadow:0 0 30px #00d4ff55}</style></head>
<body><h1>JARVIS</h1></body></html>
HUDEOF
}

# Part B: Create requirements.txt
echo "[7/8] Creating requirements.txt..."
cat > /opt/jarvis-display-home/requirements.txt << 'REQEOF'
flask>=3.0
websockets>=10.4
REQEOF

# Part B: Create display daemon service
echo "[8/8] Creating jarvis-display-home.service..."
cat > /etc/systemd/system/jarvis-display-home.service << 'SVCEOF'
[Unit]
Description=Jarvis Display Control Daemon (Home eDP-1)
After=network-online.target kiosk-home.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/jarvis-display-home/display_daemon.py
WorkingDirectory=/opt/jarvis-display-home
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SVCEOF

# Enable and start services
echo "=== Enabling services ==="
systemctl daemon-reload
systemctl enable kiosk-home.service
systemctl enable jarvis-display-home.service

echo "=== Starting kiosk-home.service ==="
systemctl start kiosk-home.service || echo "WARNING: kiosk-home failed to start (may need display connected)"

echo "=== Waiting for X11... ==="
sleep 3

echo "=== Starting jarvis-display-home.service ==="
systemctl start jarvis-display-home.service || echo "WARNING: display daemon failed to start"

sleep 2

echo "=== Verification ==="
echo "kiosk-home: $(systemctl is-active kiosk-home.service 2>/dev/null || echo 'inactive')"
echo "jarvis-display-home: $(systemctl is-active jarvis-display-home.service 2>/dev/null || echo 'inactive')"
curl -s http://localhost:8766/display/status 2>/dev/null && echo "" || echo "Display daemon not responding yet"

echo "=== Done ==="
