# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Claude operates as a **root-level autonomous operator** for the Proxmox homelab cluster with responsibility for:
- Cluster health and quorum
- Node availability
- Storage and networking integrity
- Service recovery and remediation
- Preventing and resolving faults without manual approval

Priority order: **availability > correctness > data safety**

---

## Conversation Summary Email (MANDATORY)

**At the end of EVERY conversation**, Claude MUST send an email summary to the user detailing what was accomplished. This is non-negotiable.

### When to Send
- Before the conversation ends or when the user indicates they are done
- After completing a significant set of tasks
- When asked to summarize or wrap up

### Email Format
- **Subject:** `[HomeCluster] Session Summary - <date> - <brief description>`
- **Body:** HTML formatted with:
  - Summary of issues identified
  - Actions taken and changes made
  - Current cluster status (brief)
  - Any pending items or recommendations
  - Timestamp

### How to Send
```bash
ssh root@192.168.1.61 << 'EOF'
cd /opt/agent
cat > /tmp/session-summary.js << 'SCRIPT'
require('dotenv').config();
const emailService = require('./src/services/emailService');
async function send() {
  emailService.init();
  await emailService.sendNotification(
    'amazing2000zame@gmail.com',
    '[HomeCluster] Session Summary - DATE - DESCRIPTION',
    `<html>
      <body>
        <h2>Session Summary</h2>
        <h3>Issues Identified</h3>
        <ul><li>Issue 1</li></ul>
        <h3>Actions Taken</h3>
        <ul><li>Action 1</li></ul>
        <h3>Recommendations</h3>
        <ul><li>Recommendation 1</li></ul>
        <p><em>Generated: TIMESTAMP</em></p>
      </body>
    </html>`
  );
}
send();
SCRIPT
node /tmp/session-summary.js
EOF
```

---

## Cluster: HomeCluster

**Quorum:** 3 (4 nodes total)

| Hostname | IP | Role | CPUs | RAM |
|----------|-----|------|------|-----|
| Home | 192.168.1.50 | Cluster master (this node) | 20 | 24 GB |
| pve | 192.168.1.74 | Compute + NAS (Samba) | 6 | 31 GB |
| agent1 | 192.168.1.61 | Compute | 14 | 31 GB |
| agent | 192.168.1.62 | Lightweight / utility | 2 | 4 GB |

Subnet: `192.168.1.0/24`, Gateway: `192.168.1.1`

---

## VMs and Containers

| VMID | Name | Type | Node | Status | Purpose |
|------|------|------|------|--------|---------|
| 100 | Ubuntu-Desktop | qemu | agent1 | stopped | Desktop VM (no passthrough, migrated from Home) |
| 103 | management | qemu | pve | running | Centralized management dashboard |
| 300 | twingate | lxc | pve | running | Zero-trust VPN connector |
| 302 | adguard | lxc | pve | running | AdGuard Home DNS |
| 303 | homeassistant | lxc | agent1 | running | Home Assistant |

**Management VM** (192.168.1.65):
- Centralized dashboard for entire cluster
- Services: Homepage, Uptime Kuma, Jarvis WebUI (Open WebUI), WOL API
- Docker compose: `/opt/management/docker-compose.yml`
- VM optimized: virtio-scsi-single, iothread, discard, balloon=0

**Home Monitoring System** (separate VM at 192.168.1.60):
- Scrypted with Ring, Aqara, HomeKit plugins
- Web UI: http://192.168.1.60:11080/
- NVR recordings: 4-day retention on 4.5TB USB drive

---

## This Node (Home)

- **OS:** Debian 13 (trixie)
- **Kernel:** 6.14.11-5-pve
- **Proxmox VE:** 9.1.4
- **CPU:** Intel Core i5-13500HX (14 cores / 20 threads)
- **Primary bridge:** vmbr0
- **Docker:** Installed (172.17.0.1/16)
- **Samba:** Installed (shares: NetworkStorage2, SecurityCameras, ExternalHDD)
- **USB Drives:** 1.8TB WD (`/mnt/network-share2`), 4.5TB Seagate (`/mnt/external-hdd`)
- **NFS Export:** `/mnt/external-hdd/camera-recordings` → 192.168.1.60

---

## SSH Access

**User:** root (key-based auth only, password auth disabled on all nodes)

```bash
# SSH to cluster nodes
ssh root@192.168.1.74   # pve
ssh root@192.168.1.61   # agent1
ssh root@192.168.1.62   # agent
```

**Key locations:**
- `~/.ssh/id_ed25519` - Primary key
- `~/.ssh/id_rsa` - Secondary key
- `/etc/pve/priv/authorized_keys` - Cluster-wide authorized keys

Never request usernames, passwords, or interactive credentials. All nodes trust cluster-shared SSH keys.

---

## Storage

| Name | Type | Capacity | Status | Content | Nodes |
|------|------|----------|--------|---------|-------|
| local | dir | 112 GB | active | backup,iso,vztmpl,import | all |
| local-lvm | lvmthin | 348 GB | active | VM/CT images | Home,pve,agent |
| nvme1 | lvmthin | - | active | VM/CT images | agent1 |
| cluster-backup | dir | 4.5 TB | active | backups | Home |
| usb-storage | dir | 4.5 TB | active | ISOs/templates | Home |

**USB Drives (Home node - 192.168.1.50):**
- 1.8 TB WD (WDC WD20JDRW) → `/mnt/network-share2` (UUID: 2c7a28db)
- 4.5 TB Seagate One Touch → `/mnt/external-hdd` (UUID: 6e22c140)

**Network Storage (SMB - auth required: demehouse / HomeCluster2026!):**
- `\\192.168.1.74\NetworkStorage` - 800 GB (pve node, Toshiba HDD)
- `\\192.168.1.50\NetworkStorage2` - 1.8 TB (Home node, WD USB)
- `\\192.168.1.50\SecurityCameras` - subfolder on 1.8 TB drive
- `\\192.168.1.50\ExternalHDD` - 4.5 TB (Home node, Seagate USB)

**iPhone Access:** Files app → Connect to Server → `smb://192.168.1.50` → user: demehouse

---

## Common Commands

### Cluster Status
```bash
pvecm status                              # Cluster quorum and membership
pvesh get /nodes                          # All nodes status
pvesh get /cluster/resources --type vm    # All VMs/CTs across cluster
```

### VM/Container Management
```bash
qm list                    # List VMs on this node
pct list                   # List containers on this node
qm start/stop/status <vmid>
pct start/stop/status <ctid>
```

### Storage
```bash
pvesm status              # Storage status
lvs                       # LVM volumes
df -h                     # Disk usage
zpool status              # ZFS pools (if any)
```

### Services
```bash
systemctl status pve-cluster corosync
systemctl restart pvedaemon pveproxy
journalctl -p err -n 20   # Recent errors
```

### Network
```bash
ip addr show
cat /etc/network/interfaces
```

### Corosync Recovery
```bash
corosync-cmapctl | grep member           # View cluster members
systemctl restart corosync               # Restart corosync (use cautiously)
pvecm expected 1                         # Force quorum if majority lost
```

---

## Security Hardening (Applied Jan 25, 2026)

### SSH (All Nodes)
- `PasswordAuthentication no` - key-only authentication
- `PermitRootLogin prohibit-password` - root keys only
- `X11Forwarding no` - disabled
- Backups: `/etc/ssh/sshd_config.bak.20260125` on each node

### PVE Firewall (All Nodes)
- **Default INPUT policy: DROP**
- Config: `/etc/pve/firewall/cluster.fw` (datacenter rules + IP sets)
- Per-node: `/etc/pve/nodes/<node>/host.fw`
- Allowed from LAN: SSH (22), PVE UI (8006), Spice (3128), ICMP
- Allowed between nodes: Corosync (5405-5412), migration (60000-60050)
- Node-specific: NFS on Home, Samba on Home+pve, llama-server on Home, Jarvis backend (4000) on Home, Ceph/FTP/FileBrowser on pve

### Samba Authentication
- Guest access **disabled** on all shares
- User: `demehouse` / Password: `HomeCluster2026!`
- Configured on both Home (`/etc/samba/smb.conf`) and pve

### .env Security
- `/opt/agent/.env` on agent1: permissions `600` (owner-only)

---

## Known Issues

1. **ACME certificate renewal** - `demehouse.duckdns.org` failing due to DuckDNS nameservers not supporting CAA record queries (Let's Encrypt requirement). Monthly retry cron at `/etc/cron.d/acme-cert-retry`. Self-signed cert valid until Dec 2027.
2. **agent1 e1000e NIC** - Intel I219 network adapter prone to "Hardware Unit Hang" errors. Monitor for transmit hangs. Consider disabling TSO/GSO if recurring: `ethtool -K nic0 tso off gso off`
3. ~~**pveproxy SSL key** - `/etc/pve/local/pveproxy-ssl.key` load errors~~ (RESOLVED: Jan 18, 2026 - converted from OpenSSH to PEM format)
4. ~~**nvme1 storage** - LVM thin pool disabled in storage.cfg~~ (RESOLVED: enabled on agent1 for management VM)
5. ~~**local-lvm on agent1** - Missing pve/data thinpool~~ (RESOLVED: Jan 18, 2026 - excluded agent1 from local-lvm nodes)
6. ~~**Ceph HEALTH_WARN on pve** - 0 OSDs configured, mon/mgr running but idle~~ (RESOLVED: Jan 25, 2026 - disabled ceph-mon, ceph-mgr, ceph-crash, ceph.target on pve; packages kept as PVE dependency)
7. ~~**Home root disk at 73%**~~ (RESOLVED: Jan 25, 2026 - cleaned 11GB, expanded root from 96GB to 112GB, now at 52%)
8. ~~**Pending security updates**~~ (RESOLVED: Jan 25, 2026 - bind9 + inetutils-telnet updated on all 4 nodes)
9. ~~**USB drives invisible on Home**~~ (RESOLVED: Jan 25, 2026 - removed full USB controller passthrough from VM 100, mounted drives on host)
10. ~~**Samba guest write access**~~ (RESOLVED: Jan 25, 2026 - disabled guest, requires authentication)
11. ~~**SSH password auth enabled**~~ (RESOLVED: Jan 25, 2026 - disabled on all nodes)
12. ~~**No firewall on any node**~~ (RESOLVED: Jan 25, 2026 - PVE firewall enabled cluster-wide)
13. ~~**Broken NFS self-mount (cluster-backup)**~~ (RESOLVED: Jan 25, 2026 - converted from NFS to dir type in storage.cfg, now active at 4.5TB)
14. ~~**Orphaned VM 102 on pve**~~ (RESOLVED: Jan 25, 2026 - destroyed unused Ubuntu server VM, freed 32G)
15. ~~**Samba errors on pve**~~ (RESOLVED: Jan 25, 2026 - historical errors from commented-out shares, service clean after restart)
16. **NFS server restart pending** - Home node nfsd threads stuck in D-state from old broken NFS self-mount. Requires Home node reboot to clear. New requests work fine, just old threads stuck.
17. **pve Docker+KVM bridge conflict** - Docker sets iptables FORWARD policy to DROP, blocking VM bridge traffic. Fixed via `bridge-forward-fix.service` on pve (`iptables -I FORWARD 1 -m physdev --physdev-is-bridged -j ACCEPT`). Must persist across reboots.

---

## Wake-on-LAN (Remote Power Control)

All nodes have Wake-on-LAN enabled for remote power-on capability.

| Node | MAC Address | IP |
|------|-------------|-----|
| Home | c0:18:50:fc:ff:99 | 192.168.1.50 |
| pve | e4:54:e8:53:17:64 | 192.168.1.74 |
| agent1 | d4:a2:cd:b9:a6:20 | 192.168.1.61 |
| agent | b0:83:fe:a9:35:b1 | 192.168.1.62 |

### Command Line
```bash
wake-node status          # Show all nodes status
wake-node agent1          # Wake specific node
wake-node agent1 --wait   # Wake and wait for online
wake-node all             # Wake all nodes
```

### Web UI
- **URL:** http://192.168.1.65:3005/
- Click any offline node to send WOL packet
- Auto-refreshes status every 10 seconds

### API Endpoints
```bash
curl http://192.168.1.65:3005/status         # Get all nodes status
curl http://192.168.1.65:3005/wake/agent1    # Wake specific node
curl http://192.168.1.65:3005/wake/all       # Wake all nodes
```

### Configuration
- WOL enabled via systemd service on all nodes: `/etc/systemd/system/wol.service`
- WOL API container on management VM: `docker ps --filter name=wol-api`

---

## Cluster Configuration Files

- `/etc/pve/corosync.conf` - Cluster membership
- `/etc/pve/storage.cfg` - Storage definitions
- `/etc/pve/vzdump.cron` - Backup schedule
- `/etc/network/interfaces` - Network config
- `/etc/pve/firewall/cluster.fw` - Datacenter firewall rules
- `/etc/pve/nodes/<node>/host.fw` - Per-node firewall rules
- `/etc/samba/smb.conf` - Samba shares (Home and pve nodes)

## Email Agent

**Location:** agent1 node (192.168.1.61)
**Path:** `/opt/agent/`
**User Email:** amazing2000zame@gmail.com

### Daily Status Report
- **Schedule:** Daily at 2:00 PM EST
- **Cron file:** `/etc/cron.d/homecluster-daily-report`
- **Script:** `/opt/agent/scheduled-status-report.js`
- **Log:** `/opt/agent/logs/daily-report.log`

To manually trigger a status report:
```bash
ssh root@192.168.1.61 "cd /opt/agent && node scheduled-status-report.js"
```

### Send Custom Email
```bash
ssh root@192.168.1.61 << 'EOF'
cd /opt/agent
cat > /tmp/email.js << 'SCRIPT'
require('dotenv').config();
const emailService = require('./src/services/emailService');
async function send() {
  emailService.init();
  await emailService.sendNotification(
    'amazing2000zame@gmail.com',
    'Subject Here',
    '<h1>HTML Content Here</h1>'
  );
}
send();
SCRIPT
node /tmp/email.js
EOF
```

**Config:** `/opt/agent/.env` contains Gmail credentials (app password)

---

## Jarvis v3.1 - Local AI Assistant

**Architecture:** CPU inference on Home node + Docker backend/frontend/TTS stack

| Component | Node | Port | Purpose |
|-----------|------|------|---------|
| llama-server | Home (192.168.1.50) | 8080 | LLM inference, OpenAI-compatible API (systemd) |
| jarvis-backend | Home (192.168.1.50) | 4000 | Node.js API backend (Docker) |
| jarvis-frontend | Home (192.168.1.50) | 3004 | React UI via nginx (Docker) |
| jarvis-tts | Home (192.168.1.50) | internal | XTTS v2 voice synthesis, finetuned (Docker) |
| Open WebUI | management (192.168.1.65) | 3003 | Web chat interface (Docker on VM 103) |

**Model:** Qwen 2.5 7B Instruct (Q4_K_M quantization, 4.4GB)
**Location:** `/opt/models/qwen2.5-7b-instruct-q4_k_m.gguf` (Home node)

### Access Points
- **Jarvis UI:** http://192.168.1.50:3004
- **Web UI:** http://192.168.1.65:3003
- **API:** http://192.168.1.50:8080/v1/chat/completions (OpenAI-compatible)
- **Backend API:** http://192.168.1.50:4000/api/health

### Services
```bash
# On Home node — LLM (systemd)
systemctl status jarvis-api        # llama-server (CPU, 16 threads)
systemctl restart jarvis-api

# On Home node — Docker stack (backend, frontend, TTS)
cd /root && docker compose ps      # All 3 containers
docker compose up -d --build       # Rebuild and deploy
docker compose logs -f             # Follow logs

# On management VM (192.168.1.65)
docker ps --filter name=jarvis-webui   # Open WebUI container
```

### API Usage Example
```bash
curl http://192.168.1.50:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-7b-instruct-q4_k_m.gguf",
    "messages": [
      {"role": "system", "content": "You are Jarvis, a helpful AI assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Performance
- Prompt processing: ~75-95 tokens/sec
- Generation: ~27-52 tokens/sec
- Context: 16384 tokens
- Parallel slots: 2
- TTS synthesis: ~4s per short sentence (CPU, XTTS v2 finetuned)

### Files
- `/opt/llama.cpp/` - llama.cpp installation (Home node)
- `/opt/jarvis/` - Jarvis configuration files
- `/opt/jarvis-tts/` - TTS model, voices, training weights
- `/etc/systemd/system/jarvis-api.service` - LLM service (Home)
- `/root/docker-compose.yml` - Jarvis Docker stack (backend, frontend, TTS)
- `/root/jarvis-backend/` - Backend source code
- `/root/jarvis-ui/` - Frontend source code

### Jarvis Shell Agent

Jarvis can execute shell commands across cluster nodes via two interfaces:

**1. Open WebUI (Web Interface)**
- URL: http://192.168.1.65:3003
- Select the **J.A.R.V.I.S.** model (not the raw qwen model) to enable shell execution
- The `shell_execute` function allows Jarvis to run commands on cluster nodes
- Example prompts that trigger shell execution:
  - "What's the disk usage on pve?"
  - "Check the uptime on master"
  - "Show cluster status"
  - "List VMs on agent1"

**2. CLI Agent (Terminal Interface)**
```bash
# Run from Home node
python3 /opt/jarvis/agent.py
# Or use the symlink
jarvis-agent
```

**Available Nodes for Shell Execution:**
| Node | IP | Alias |
|------|-----|-------|
| Home | 192.168.1.50 | master, home |
| pve | 192.168.1.74 | pve |
| agent1 | 192.168.1.61 | agent1 |
| agent | 192.168.1.62 | agent |

**CLI Agent Commands:**
- `nodes` - List available nodes
- `clear` - Reset conversation
- `exit` - Quit the agent

**Shell Agent Files:**
- `/opt/jarvis/agent.py` - CLI agent script
- `/opt/jarvis/openwebui-shell-function.py` - Open WebUI function source
- `/opt/jarvis/system-prompt.txt` - System prompt configuration

**Safety:** Dangerous command patterns (rm -rf /, mkfs, etc.) are blocked.

---

## File Organization Agent

**Location:** agent1 (192.168.1.61)
**Path:** `/opt/cluster-agents/file-organizer/`
**Schedule:** Every 6 hours

Automatically scans all cluster nodes to discover projects and maintain a central registry.

### What It Does
- Scans all 4 nodes via SSH for project markers (package.json, pyproject.toml, Dockerfile, etc.)
- Maintains central registry at `agent1:/opt/cluster-agents/file-organizer/data/registry.json`
- Generates `/root/PROJECT_REGISTRY.md` on Home node (project listing)
- Generates `/root/CLAUDE.md` on other nodes (node-specific context)
- Sends daily email reports with changes

### Commands
```bash
# Run manually
ssh root@192.168.1.61 "cd /opt/cluster-agents && npm run organizer"

# Scan only (no context generation)
ssh root@192.168.1.61 "cd /opt/cluster-agents && node file-organizer/index.js --scan-only"

# Generate context files only
ssh root@192.168.1.61 "cd /opt/cluster-agents && node file-organizer/index.js --generate-only"

# View registry (24 projects indexed)
ssh root@192.168.1.61 "cat /opt/cluster-agents/file-organizer/data/registry.json | jq"

# Check logs
ssh root@192.168.1.61 "tail -50 /opt/cluster-agents/file-organizer/logs/file-organizer.log"
```

### File Structure
```
/opt/cluster-agents/file-organizer/
├── index.js              # Main entry point
├── modules/
│   ├── scanner.js        # SSH project discovery
│   ├── registry.js       # Registry CRUD operations
│   ├── context-gen.js    # CLAUDE.md generation
│   └── reporter.js       # Email reports
├── rules/structure.json  # Organization rules
└── data/
    ├── registry.json     # Central project registry
    └── change-history.json
```

### Related Files
- `/root/PROJECT_REGISTRY.md` - Auto-generated project listing (this node)
- Other nodes: `/root/CLAUDE.md` - Auto-generated node context

---

## Documentation

- `/root/documentation/home-monitoring-project/` - Scrypted setup guides
- `/root/documentation/security-monitor-setup/` - Security camera VM setup
- `/root/documentation/NETWORK_STORAGE_SETUP.txt` - SMB share configuration
- `/root/documentation/MANAGEMENT_VM_SETUP.md` - Management VM setup and credentials
