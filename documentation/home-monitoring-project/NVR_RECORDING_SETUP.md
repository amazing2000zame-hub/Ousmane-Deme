# Scrypted NVR Recording Setup - 4-Day Retention

**Storage:** 4.5TB USB Drive (4.3TB available)
**Location:** `/mnt/recordings/camera-recordings` on VM
**Docker Path:** `/recordings` inside Scrypted container

---

## Step 1: Install Scrypted NVR Plugin

1. Open Scrypted web interface: http://192.168.1.60:11080/
2. Go to **Plugins** → **Install Plugin**
3. Search for "**NVR**"
4. Click **Install** on the "Scrypted NVR" plugin
5. Wait for installation to complete

---

## Step 2: Configure Storage for NVR

1. In Scrypted, go to **Plugins** → **Scrypted NVR**
2. Click on **Settings** (gear icon)
3. Find the **Storage Path** setting
4. Set it to: `/recordings`
5. Click **Save**

---

## Step 3: Enable Recording for Each Camera

For each camera (Front Door, Side, etc.):

1. Go to the camera device in Scrypted
2. Click on the camera name
3. Find the **Extensions** section
4. Enable the **NVR** extension
5. Click on **NVR Settings** for that camera
6. Configure the following:

   **Recording Settings:**
   - **Recording Mode:** Motion or Continuous (your choice)
   - **Motion Detection:** Enable if using motion-based recording
   - **Pre-Recording Buffer:** 10-30 seconds (captures before motion event)
   - **Post-Recording Buffer:** 10-30 seconds (continues after motion stops)

   **Retention Settings:**
   - **Recording Retention:** `4` days
   - **Recording Retention Unit:** Days

7. Click **Save**

---

## Step 4: Verify Recording is Working

1. Wait for motion events or trigger one manually
2. Go to **Plugins** → **Scrypted NVR**
3. Click **View Recordings** or open the NVR interface
4. You should see recordings appearing in the timeline
5. Verify files are being saved to the USB drive:
   ```bash
   ssh root@192.168.1.60 "ls -lh /mnt/recordings/camera-recordings/"
   ```

---

## Automatic 4-Day Retention

The NVR plugin will automatically:
- Delete recordings older than 4 days
- Manage disk space
- Keep the most recent 4 days of footage

You can monitor storage usage:
```bash
ssh root@192.168.1.60 "df -h /mnt/recordings"
```

---

## Estimated Storage Capacity

With 4.3TB available:
- **Continuous recording** (all cameras, 24/7):
  - ~2-3 cameras: 4+ days
  - Actual duration depends on resolution and bitrate

- **Motion-only recording**:
  - Can store weeks/months of footage depending on activity

The 4-day retention will keep the drive from filling up.

---

##Alternative: Manual Cleanup Script (Optional)

If you want additional cleanup control, you can create a cron job:

```bash
# SSH into VM
ssh root@192.168.1.60

# Create cleanup script
cat > /usr/local/bin/cleanup-recordings.sh <<'SCRIPT'
#!/bin/bash
# Delete recordings older than 4 days
find /mnt/recordings/camera-recordings -type f -mtime +4 -delete
echo "Cleaned up recordings older than 4 days: $(date)"
SCRIPT

chmod +x /usr/local/bin/cleanup-recordings.sh

# Add to crontab (runs daily at 3 AM)
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/cleanup-recordings.sh >> /var/log/recording-cleanup.log 2>&1") | crontab -
```

---

## Monitoring and Maintenance

### Check Disk Space
```bash
ssh root@192.168.1.60 "df -h /mnt/recordings"
```

### View Recording Files
```bash
ssh root@192.168.1.60 "ls -lht /mnt/recordings/camera-recordings/ | head -20"
```

### Check NVR Status
1. Go to Scrypted web UI
2. Navigate to **Plugins** → **Scrypted NVR**
3. View recording statistics and storage usage

### Restart Scrypted (if needed)
```bash
ssh root@192.168.1.60 "docker restart scrypted"
```

---

## Troubleshooting

### Recordings Not Saving
1. Check NVR plugin is installed and enabled
2. Verify storage path is set to `/recordings`
3. Ensure camera has NVR extension enabled
4. Check Docker logs:
   ```bash
   ssh root@192.168.1.60 "docker logs scrypted | grep -i nvr"
   ```

### Disk Full Despite 4-Day Retention
1. Check if retention is properly configured per camera
2. Manually delete old files:
   ```bash
   ssh root@192.168.1.60 "find /mnt/recordings/camera-recordings -type f -mtime +4 -delete"
   ```
3. Restart NVR plugin in Scrypted

### USB Drive Not Mounted After Reboot
```bash
# SSH into VM
ssh root@192.168.1.60

# Check if mounted
mount | grep recordings

# If not mounted, mount manually
mount -a

# Restart Scrypted
docker restart scrypted
```

---

## Important Notes

- **Backup Important Footage:** If you have critical events, export them before the 4-day retention deletes them
- **Power Loss:** The USB drive is configured to auto-mount on boot
- **Drive Health:** Monitor the USB drive health periodically
- **Network Issues:** Recordings continue locally even if internet is down

---

**Storage Device:** Seagate One Touch 4.5TB
**UUID:** 0B37-37DB
**Format:** exFAT
**Mount Point:** /mnt/recordings
**Auto-mount:** Yes (configured in /etc/fstab)
