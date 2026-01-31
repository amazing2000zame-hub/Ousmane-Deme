#!/bin/bash

# Proxmox VM Creation Script for Security Monitor
# Run this on your Proxmox host (not in the VM)

# CUSTOMIZE THESE VARIABLES
VMID=100                          # Change if this ID is already used
VMNAME="security-monitor"
STORAGE="local-lvm"               # Change to your storage name
ISO_STORAGE="local"               # ISO storage location
ISO_FILE="ubuntu-24.04-live-server-amd64.iso"  # Update with your ISO filename
BRIDGE="vmbr0"                    # Network bridge

# VM SPECIFICATIONS
CORES=6
MEMORY=8192  # 8GB in MB
DISK_SIZE="32G"

echo "======================================"
echo "Creating Proxmox VM: $VMNAME"
echo "======================================"
echo "VM ID: $VMID"
echo "Cores: $CORES"
echo "Memory: ${MEMORY}MB"
echo "Disk: $DISK_SIZE"
echo ""
read -p "Press Enter to create VM or Ctrl+C to cancel..."

# Create the VM
qm create $VMID \
  --name $VMNAME \
  --ostype l26 \
  --memory $MEMORY \
  --cores $CORES \
  --cpu host \
  --net0 virtio,bridge=$BRIDGE \
  --scsihw virtio-scsi-single \
  --scsi0 $STORAGE:$DISK_SIZE,cache=writeback,discard=on \
  --ide2 $ISO_STORAGE:iso/$ISO_FILE,media=cdrom \
  --boot order=scsi0 \
  --bios ovmf \
  --machine q35 \
  --efidisk0 $STORAGE:1,format=raw,efitype=4m,pre-enrolled-keys=1

echo ""
echo "======================================"
echo "VM Created Successfully!"
echo "======================================"
echo "VM ID: $VMID"
echo "Name: $VMNAME"
echo ""
echo "Next steps:"
echo "1. In Proxmox web UI, start the VM"
echo "2. Open console and install Ubuntu Server"
echo "3. After Ubuntu installation, follow QUICKSTART.txt"
echo ""
echo "Optional - Add GPU passthrough:"
echo "  In Proxmox UI: VM → Hardware → Add → PCI Device"
echo "  Select your GPU and check 'Primary GPU'"
echo ""
