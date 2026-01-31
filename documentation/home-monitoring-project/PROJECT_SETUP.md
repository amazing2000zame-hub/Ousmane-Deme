# Home Monitoring System - Complete Setup Guide

**Created:** December 31, 2025
**VM IP:** 192.168.1.60
**Scrypted Web UI:** http://192.168.1.60:11080/

---

## System Overview

This is a complete home monitoring system built on Proxmox with Scrypted, designed to display all your cameras, doorbells, and locks on a wall-mounted screen via HDMI.

### Components
- **Platform:** Proxmox VE 9.1.4
- **VM ID:** 100 (home-monitoring)
- **OS:** Ubuntu 22.04 LTS
- **Smart Home Platform:** Scrypted (Docker)
- **Display:** Chromium browser in kiosk mode (auto-starts on boot)

### Hardware Specs
- CPU: 8 cores
- RAM: 8GB
- Storage: 100GB
- Network: Bridged (vmbr0)

---

## Access Information

### SSH Access
```bash
ssh root@192.168.1.60
Password: Lexeiba2025
```

Or from Proxmox host:
```bash
ssh -i /root/.ssh/scrypted_key root@192.168.1.60
```

### Scrypted Web Interface
- **HTTPS:** https://192.168.1.60:10443/
- **HTTP:** http://192.168.1.60:11080/

---

## Initial Scrypted Setup

### Step 1: Access Scrypted
1. Open a web browser and go to http://192.168.1.60:11080/
2. Complete the first-time setup wizard
3. Create an admin username and password (**SAVE THESE!**)

### Step 2: Install Required Plugins

#### Install Ring Plugin
1. In Scrypted, go to **Plugins** → **Install Plugin**
2. Search for "Ring"
3. Click **Install** on the Ring plugin
4. After installation, go to the Ring plugin settings
5. Click **Login to Ring**
6. Enter your Ring account credentials
7. Complete 2FA if required
8. Your Ring devices (cameras, doorbells, locks) will appear in Scrypted

#### Install Apple HomeKit Plugin
1. Go to **Plugins** → **Install Plugin**
2. Search for "HomeKit"
3. Click **Install** on the HomeKit plugin
4. After installation, go to HomeKit plugin settings
5. A QR code will be displayed
6. Open the Home app on your iPhone/iPad
7. Tap **Add Accessory** and scan the QR code
8. Your Scrypted devices will now be available in HomeKit

#### Install Aqara Plugin
1. Go to **Plugins** → **Install Plugin**
2. Search for "Aqara"
3. Click **Install** on the Aqara Home plugin
4. After installation, go to Aqara plugin settings
5. Sign in with your Aqara account credentials
6. Your Aqara devices (smart doorbell, door lock) will be discovered

---

## Configuring the Display Dashboard

### Creating a Monitoring View
1. In Scrypted web UI, go to **Console** or create a custom view
2. Add all your cameras and devices to the view
3. Arrange them in a grid layout
4. The kiosk browser will display this view full-screen on your HDMI display

### Auto-Start Configuration
The system is configured to:
- Auto-login as root on boot
- Start Openbox window manager
- Launch Chromium in kiosk mode pointing to Scrypted
- Display full-screen on HDMI output

---

## Managing the System

### Restart Scrypted Container
```bash
ssh root@192.168.1.60
docker restart scrypted
```

### View Scrypted Logs
```bash
ssh root@192.168.1.60
docker logs scrypted -f
```

### Restart the VM
From Proxmox:
```bash
qm stop 100 && qm start 100
```

### Reboot the Display
```bash
ssh root@192.168.1.60 "reboot"
```

---

## HDMI Passthrough Configuration

The VM is configured with standard VGA output which Proxmox will route to HDMI. If you need dedicated GPU passthrough:

1. Identify your GPU:
```bash
lspci -nn | grep -i vga
```

2. Configure GPU passthrough in `/etc/pve/qemu-server/100.conf`:
```
hostpci0: 00:02.0,pcie=1
```

3. Restart the VM

---

## Troubleshooting

### Display Not Showing
1. Check if Chromium is running:
```bash
ssh root@192.168.1.60 "ps aux | grep chromium"
```

2. Restart LightDM:
```bash
ssh root@192.168.1.60 "systemctl restart lightdm"
```

### Scrypted Not Accessible
1. Check if container is running:
```bash
ssh root@192.168.1.60 "docker ps"
```

2. Restart if needed:
```bash
ssh root@192.168.1.60 "docker restart scrypted"
```

### Ring Devices Not Connecting
- Verify Ring credentials in plugin settings
- Check that 2FA is completed
- Restart Ring plugin in Scrypted

### Aqara Devices Not Found
- Ensure Aqara account is properly linked
- Check that devices are online in Aqara app
- Refresh device list in Scrypted

---

## Useful Commands

### VM Management (from Proxmox)
```bash
# Start VM
qm start 100

# Stop VM
qm stop 100

# Restart VM
qm stop 100 && qm start 100

# Check VM status
qm status 100

# View VM config
qm config 100
```

### Docker Management (in VM)
```bash
# View running containers
docker ps

# View all containers
docker ps -a

# Restart Scrypted
docker restart scrypted

# View logs
docker logs scrypted -f

# Stop Scrypted
docker stop scrypted

# Start Scrypted
docker start scrypted
```

---

## Backup and Maintenance

### Backup Scrypted Data
The Scrypted configuration is stored in `/root/.scrypted` on the VM.

To backup:
```bash
ssh root@192.168.1.60 "tar -czf /root/scrypted-backup-$(date +%Y%m%d).tar.gz /root/.scrypted"
```

### Backup Entire VM
From Proxmox:
```bash
vzdump 100 --mode snapshot --storage local
```

---

## Security Recommendations

1. **Change Default Password:** Update the root password from Lexeiba2025 to something more secure
2. **Enable Firewall:** Configure firewall rules to restrict access
3. **SSL Certificate:** Set up proper SSL certificate for Scrypted HTTPS access
4. **Network Isolation:** Consider putting smart home devices on a separate VLAN
5. **Regular Updates:** Keep Ubuntu, Docker, and Scrypted updated

---

## Support and Resources

- **Scrypted Documentation:** https://docs.scrypted.app/
- **Scrypted Discord:** https://discord.gg/DcFzmBHYGq
- **Ring Plugin:** Check Scrypted plugin marketplace
- **HomeKit Plugin:** Built-in Scrypted feature
- **Aqara Plugin:** Check compatibility with your specific devices

---

## Next Steps

1. ✅ Access Scrypted web interface (http://192.168.1.60:11080/)
2. ✅ Create admin account
3. ⏳ Install Ring plugin and connect devices
4. ⏳ Install HomeKit plugin and pair with iPhone
5. ⏳ Install Aqara plugin and connect doorbell/lock
6. ⏳ Configure dashboard view
7. ⏳ Test HDMI display output
8. ⏳ Fine-tune layout and settings

---

**Project completed by Claude on 2025-12-31**
