# Management VM Setup - HomeCluster Dashboard

## Overview
A centralized management VM has been deployed on agent1 providing a single pane of glass for the entire HomeCluster.

## Management VM Details
- **VMID:** 103
- **Name:** management
- **Node:** agent1
- **IP Address:** 192.168.1.65
- **Resources:** 4 CPU, 8GB RAM, 50GB disk
- **OS:** Ubuntu 24.04 LTS
- **Docker:** v29.1.5
- **SSH:** Key-based auth (same keys as cluster nodes)

## Service Access URLs

| Service | URL | Description |
|---------|-----|-------------|
| **Dashboard** | http://192.168.1.65/ | Homepage - Main dashboard |
| **Shell Access** | http://192.168.1.65:8080/guacamole | Browser-based SSH to all nodes |
| **File Browser** | http://192.168.1.65:8081 | Web file manager with SMB access |
| **Docker** | http://192.168.1.65:9000 | Portainer container management |
| **Monitoring** | http://192.168.1.65:3001 | Uptime Kuma status page |
| **Proxy Admin** | http://192.168.1.65:81 | Nginx Proxy Manager admin |

## Credentials

### Guacamole (Browser SSH)
- **URL:** http://192.168.1.65:8080/guacamole
- **Username:** guacadmin
- **Password:** guacadmin
- **Pre-configured connections:**
  - Home (Master) - 192.168.1.50
  - pve (NAS) - 192.168.1.74
  - agent1 (Compute) - 192.168.1.61
  - agent (Utility) - 192.168.1.62

### File Browser
- **URL:** http://192.168.1.65:8081
- **Username:** admin
- **Password:** jZHbGQDxiTDYh97h
- **Mounted shares:**
  - /NetworkStorage (787GB on pve)
  - /NetworkStorage2 (94GB on pve)

### Portainer
- **URL:** http://192.168.1.65:9000
- **First login:** Create admin account on first access

### Uptime Kuma
- **URL:** http://192.168.1.65:3001
- **First login:** Create admin account on first access

### Nginx Proxy Manager
- **URL:** http://192.168.1.65:81
- **Email:** admin@homelab.local
- **Password:** HomeCluster2024!

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MANAGEMENT VM (agent1)                    │
│                     192.168.1.65                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Homepage   │  │  Guacamole  │  │ File Browser│         │
│  │    :3000    │  │    :8080    │  │    :8081    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Portainer  │  │ Uptime Kuma │  │Nginx Proxy  │         │
│  │    :9000    │  │    :3001    │  │  Manager    │         │
│  └─────────────┘  └─────────────┘  │  :80/81/443 │         │
│                                     └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │   Home   │        │   pve    │        │  agent   │
    │  Master  │        │   NAS    │        │  Light   │
    │ .1.50    │        │ .1.74    │        │ .1.62    │
    └──────────┘        └──────────┘        └──────────┘
```

## Docker Containers

```bash
# Check status
ssh root@192.168.1.65 "docker compose -f /opt/management/docker-compose.yml ps"

# Restart all services
ssh root@192.168.1.65 "docker compose -f /opt/management/docker-compose.yml restart"

# View logs
ssh root@192.168.1.65 "docker compose -f /opt/management/docker-compose.yml logs -f"
```

## Configuration Files

| File | Purpose |
|------|---------|
| /opt/management/docker-compose.yml | Main compose file |
| /opt/management/homepage/config/ | Homepage configuration |
| /opt/management/nginx-proxy-manager/ | NPM data |
| /opt/management/guacamole/ | Guacamole database |
| /opt/management/portainer/ | Portainer data |
| /opt/management/uptime-kuma/ | Uptime Kuma data |
| /opt/management/smb-mounts/ | Mounted SMB shares |

## Post-Setup Tasks

### Recommended First Steps
1. **Change default passwords** for Guacamole and File Browser
2. **Set up Portainer** - create admin account on first login
3. **Configure Uptime Kuma** - add monitors for all services
4. **Add to Twingate** - add 192.168.1.65 as a resource for remote access

### Adding Proxmox Widgets to Homepage
To enable live Proxmox stats in Homepage, create API tokens on each node:
```bash
# On each Proxmox node
pveum user add api@pam
pveum aclmod / -user api@pam -role PVEAuditor
pveum user token add api@pam homepage --privsep=0
```
Then update /opt/management/homepage/config/services.yaml with the tokens.

## Troubleshooting

### Service not responding
```bash
ssh root@192.168.1.65 "docker compose -f /opt/management/docker-compose.yml restart <service>"
```

### SMB mounts not working
```bash
ssh root@192.168.1.65 "mount -a"
```

### Check container logs
```bash
ssh root@192.168.1.65 "docker logs <container_name>"
```

---
*Generated: 2026-01-18*
*Management VM deployed on agent1 (VMID 103)*
