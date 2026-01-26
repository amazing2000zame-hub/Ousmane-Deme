/**
 * Protected resources that must NEVER be targeted by automated actions.
 *
 * These resources are critical to Jarvis's own operation or cluster stability.
 * Any tool invocation targeting a protected resource is blocked regardless of
 * action tier or confirmation status.
 */

export const PROTECTED_RESOURCES = {
  /** Nodes that host Jarvis infrastructure */
  nodes: ['agent1'] as const,

  /** VMIDs running Jarvis services (management VM) */
  vmids: [103] as const,

  /** Services whose restart would kill Jarvis itself */
  services: ['docker.service', 'docker'] as const,

  /** IPs that map to protected infrastructure */
  ips: ['192.168.1.61', '192.168.1.65'] as const,
} as const;

/**
 * Check whether a tool invocation targets a protected resource.
 *
 * Inspects common argument keys (node, vmid, service, host, ip, target)
 * and matches against the protected resource lists.
 */
export function isProtectedResource(args: Record<string, unknown>): {
  protected: boolean;
  resource?: string;
  reason?: string;
} {
  // Check node name
  const node = args.node ?? args.target;
  if (typeof node === 'string') {
    const lower = node.toLowerCase();
    for (const pn of PROTECTED_RESOURCES.nodes) {
      if (lower === pn.toLowerCase()) {
        return {
          protected: true,
          resource: `node:${node}`,
          reason: `Node "${node}" hosts Jarvis infrastructure and cannot be targeted by automated actions`,
        };
      }
    }
  }

  // Check VMID
  const vmid = args.vmid ?? args.id;
  if (vmid !== undefined) {
    const numericVmid = typeof vmid === 'string' ? parseInt(vmid, 10) : Number(vmid);
    if (PROTECTED_RESOURCES.vmids.includes(numericVmid as 103)) {
      return {
        protected: true,
        resource: `vmid:${numericVmid}`,
        reason: `VMID ${numericVmid} is the management VM and cannot be targeted by automated actions`,
      };
    }
  }

  // Check service name
  const service = args.service ?? args.serviceName;
  if (typeof service === 'string') {
    const lower = service.toLowerCase();
    for (const ps of PROTECTED_RESOURCES.services) {
      if (lower === ps.toLowerCase()) {
        return {
          protected: true,
          resource: `service:${service}`,
          reason: `Service "${service}" is critical to Jarvis operation and cannot be restarted by automated actions`,
        };
      }
    }
  }

  // Check IP address
  const ip = args.host ?? args.ip;
  if (typeof ip === 'string') {
    for (const pip of PROTECTED_RESOURCES.ips) {
      if (ip === pip) {
        return {
          protected: true,
          resource: `ip:${ip}`,
          reason: `IP ${ip} belongs to protected Jarvis infrastructure`,
        };
      }
    }
  }

  // Check command string for protected references
  const command = args.command ?? args.cmd;
  if (typeof command === 'string') {
    // Check if command targets a protected service
    for (const ps of PROTECTED_RESOURCES.services) {
      if (command.includes(ps)) {
        return {
          protected: true,
          resource: `service:${ps}`,
          reason: `Command references protected service "${ps}"`,
        };
      }
    }
  }

  return { protected: false };
}
