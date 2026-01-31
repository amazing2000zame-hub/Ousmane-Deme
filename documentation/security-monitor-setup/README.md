# Security Monitor VM Setup

Complete setup package for a security camera monitoring system using Home Assistant and Scrypted for Ring cameras and door locks.

## System Requirements

- Proxmox VE host
- 8GB RAM allocated to VM
- 6 CPU cores allocated to VM
- 32GB+ storage
- GPU for HDMI output (optional but recommended)
- Ubuntu Server 24.04 LTS ISO

## What This Includes

- **Home Assistant**: Smart home platform for managing all devices
- **Scrypted**: Video integration platform with Ring plugin support
- **Kiosk Mode**: Auto-launching fullscreen dashboard on connected monitor
- **Automatic Updates**: Watchtower for keeping containers updated

---

## Quick Start Guide

### Part 1: Create VM in Proxmox

1. **Download Ubuntu Server 24.04 LTS ISO** to your Proxmox server
   - Upload via Proxmox UI: Datacenter → Storage → ISO Images → Upload

2. **Create the VM** (Proxmox Web Interface):
   ```
   Click "Create VM" button (top right)

   General Tab:
   - VM ID: (auto or choose)
   - Name: security-monitor

   OS Tab:
   - ISO image: Select Ubuntu Server 24.04 LTS
   - Type: Linux
   - Version: 6.x - 2.6 Kernel

   System Tab:
   - Graphic card: Default
   - Machine: q35
   - BIOS: OVMF (UEFI)
   - Add EFI Disk: YES
   - SCSI Controller: VirtIO SCSI single

   Disks Tab:
   - Bus/Device: SCSI
   - Storage: local-lvm (or your storage)
   - Disk size: 32 (or more)
   - Cache: Write back
   - Discard: YES

   CPU Tab:
   - Sockets: 1
   - Cores: 6
   - Type: host

   Memory Tab:
   - Memory (MiB): 8192
   - Ballooning Device: YES

   Network Tab:
   - Bridge: vmbr0
   - Model: VirtIO (paravirtualized)
   ```

3. **Add GPU Passthrough** (for HDMI monitor - OPTIONAL):
   ```
   Select VM → Hardware → Add → PCI Device
   - Select your GPU device
   - Check "All Functions"
   - Check "Primary GPU" (if you want video output)
   - Check "PCI-Express"
   ```

4. **Start the VM** and proceed with Ubuntu installation

### Part 2: Install Ubuntu Server

1. **Boot the VM** and follow Ubuntu installer:
   - Language: English
   - Keyboard: Your layout
   - Network: DHCP (or configure static IP)
   - Storage: Use entire disk
   - Profile Setup:
     - Your name: (your choice)
     - Server name: security-monitor
     - Username: (your choice)
     - Password: (secure password)
   - SSH Setup: Install OpenSSH server ✓
   - Featured Server Snaps: Skip (don't install anything)

2. **Wait for installation to complete** and reboot

3. **Login** to the VM console or via SSH

### Part 3: Run Setup Scripts

1. **Copy this folder to your VM**:
   ```bash
   # From your computer, use SCP:
   scp -r security-monitor-setup username@VM-IP:~/

   # Or use SFTP, or manually copy files
   ```

2. **SSH into your VM**:
   ```bash
   ssh username@VM-IP
   ```

3. **Navigate to setup directory**:
   ```bash
   cd ~/security-monitor-setup
   ```

4. **Make scripts executable**:
   ```bash
   chmod +x *.sh
   ```

5. **Run the master setup script**:
   ```bash
   ./master-setup.sh
   ```

   This will:
   - Install Docker and Docker Compose
   - Deploy Home Assistant and Scrypted containers
   - Optionally configure kiosk mode
   - Show you the URLs to access your services

6. **If you enabled kiosk mode, reboot**:
   ```bash
   sudo reboot
   ```

---

## Post-Installation Configuration

### Configure Home Assistant

1. Open http://VM-IP:8123 in your web browser
2. Complete the initial setup wizard:
   - Create your account
   - Name your home
   - Set location (for weather, etc.)
   - Choose units (metric/imperial)
3. Click Finish

### Configure Scrypted

1. Open http://VM-IP:10443 in your web browser
2. Complete initial setup:
   - Create admin account
   - Set up local access

### Install Ring Plugin in Scrypted

1. In Scrypted, go to **Plugins** (left sidebar)
2. Click **Install Plugins** (top right)
3. Search for **"Ring"**
4. Click **Install** on the Ring plugin
5. After installation, click on **Ring** in the plugin list
6. Click **Settings**
7. Enter your **Ring email** and **password**
8. Complete 2FA if required
9. Your Ring cameras and door locks will appear in the device list

### Connect Scrypted to Home Assistant

1. In Home Assistant, go to **Settings** → **Devices & Services**
2. Click **Add Integration** (bottom right)
3. Search for **"Scrypted"**
4. Enter Scrypted URL: `http://localhost:10443`
5. Click Submit
6. Your Ring devices will now appear in Home Assistant

### Create Dashboard for Monitor

1. In Home Assistant, go to **Overview** (left sidebar)
2. Click the **three dots** (top right) → **Edit Dashboard**
3. Click **Add Card**
4. Add camera cards for your Ring cameras:
   - Choose **Picture Entity Card** or **Picture Glance Card**
   - Select your Ring camera
   - Repeat for each camera
5. Arrange cards as desired
6. Click **Done**

---

## Kiosk Mode Controls

If you enabled kiosk mode, the monitor will automatically show Home Assistant in fullscreen.

**Useful keyboard shortcuts:**
- `Alt + F4`: Exit fullscreen/kiosk mode
- `Ctrl + Alt + F1-F6`: Switch to different TTY terminals
- `Ctrl + Alt + F7`: Return to graphical interface

To disable kiosk mode temporarily, edit `~/.bash_profile` and comment out the startx line.

---

## Managing Containers

All containers are managed via Docker Compose in `~/security-system/`

### View container status:
```bash
cd ~/security-system
docker-compose ps
```

### View logs:
```bash
docker-compose logs -f homeassistant
docker-compose logs -f scrypted
```

### Restart containers:
```bash
docker-compose restart
```

### Stop containers:
```bash
docker-compose down
```

### Start containers:
```bash
docker-compose up -d
```

### Update containers:
```bash
docker-compose pull
docker-compose up -d
```

---

## Troubleshooting

### Home Assistant not accessible
```bash
docker logs homeassistant
# Check if container is running
docker ps
```

### Scrypted not accessible
```bash
docker logs scrypted
# Restart Scrypted
docker restart scrypted
```

### Kiosk mode not starting
- Check `~/.bash_profile` for startx command
- Check `~/.config/openbox/autostart` for chromium command
- View X server logs: `cat ~/.local/share/xorg/Xorg.0.log`

### Ring cameras not appearing
- Verify Ring credentials in Scrypted
- Check Scrypted logs: `docker logs scrypted`
- Ensure 2FA is completed

### GPU/HDMI not working
- Verify GPU passthrough in Proxmox VM hardware settings
- Check if GPU is visible: `lspci | grep VGA`
- May need to install GPU drivers (NVIDIA/AMD specific)

---

## Security Notes

1. **Change default passwords** immediately after setup
2. **Use strong passwords** for Home Assistant and Scrypted
3. **Enable 2FA** in Home Assistant (Settings → Your Account → Two-Factor Authentication)
4. **Firewall**: Consider restricting access to ports 8123 and 10443
5. **Regular updates**: Containers auto-update nightly at 4 AM via Watchtower

---

## File Structure

```
security-monitor-setup/
├── README.md                   # This file
├── master-setup.sh             # Main setup script
├── install-docker.sh           # Docker installation script
├── setup-kiosk.sh              # Kiosk mode configuration script
└── docker-compose.yml          # Container definitions

After installation:
~/security-system/
├── docker-compose.yml          # Container configuration
├── homeassistant/              # Home Assistant config
└── scrypted/                   # Scrypted data
```

---

## Support

- Home Assistant Docs: https://www.home-assistant.io/docs/
- Scrypted Docs: https://docs.scrypted.app/
- Ring Plugin: https://github.com/koush/scrypted/wiki/Ring

---

## Credits

Setup configured for maximum security camera monitoring performance with Ring integration.
