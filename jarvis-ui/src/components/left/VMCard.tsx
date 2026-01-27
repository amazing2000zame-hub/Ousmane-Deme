import { memo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { VMData } from '../../types/cluster';
import { executeToolApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { StatusDot } from '../shared/StatusDot';
import ConfirmDialog from '../shared/ConfirmDialog';
import { GlowBorder } from '../shared/GlowBorder';

type VMAction = 'start' | 'stop' | 'restart';

interface ConfirmState {
  open: boolean;
  action: VMAction | null;
}

/** Map VMData status to StatusDot status */
function toStatusDotStatus(vmStatus: VMData['status']): 'online' | 'offline' | 'warning' | 'unknown' {
  switch (vmStatus) {
    case 'running':
      return 'online';
    case 'stopped':
      return 'offline';
    case 'paused':
      return 'warning';
    default:
      return 'unknown';
  }
}

/**
 * PERF-18: Wrapped in React.memo — re-renders only when its own VM data changes.
 */
export const VMCard = memo(function VMCard({ vm }: { vm: VMData }) {
  const token = useAuthStore((s) => s.token);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false, action: null });
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);

  const getToolName = useCallback(
    (action: VMAction): string => {
      const prefix = vm.type === 'qemu' ? 'vm' : 'container';
      switch (action) {
        case 'start':
          return `start_${prefix}`;
        case 'stop':
          return `stop_${prefix}`;
        case 'restart':
          return `restart_${prefix}`;
      }
    },
    [vm.type],
  );

  const flash = useCallback((color: 'green' | 'red') => {
    setFlashColor(color);
    setTimeout(() => setFlashColor(null), 1200);
  }, []);

  const executeAction = useCallback(
    async (action: VMAction) => {
      if (!token) {
        toast.error('Not authenticated');
        return;
      }

      setLoading(true);
      const tool = getToolName(action);
      const args: Record<string, unknown> = { node: vm.node, vmid: vm.vmid };

      // Destructive operations pass confirmed flag
      if (action === 'stop' || action === 'restart') {
        args.confirmed = true;
      }

      try {
        await executeToolApi(tool, args, token);
        toast.success(`${vm.name || `VM ${vm.vmid}`} ${action} initiated`);
        flash('green');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        toast.error(`Failed to ${action} ${vm.name || `VM ${vm.vmid}`}: ${message}`);
        flash('red');
      } finally {
        setLoading(false);
      }
    },
    [token, getToolName, vm.node, vm.vmid, vm.name, flash],
  );

  const handleStart = useCallback(() => {
    void executeAction('start');
  }, [executeAction]);

  const handleDestructiveAction = useCallback((action: VMAction) => {
    setConfirm({ open: true, action });
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirm.action) {
      void executeAction(confirm.action);
    }
    setConfirm({ open: false, action: null });
  }, [confirm.action, executeAction]);

  const handleCancel = useCallback(() => {
    setConfirm({ open: false, action: null });
  }, []);

  const typeBadge = vm.type === 'qemu' ? 'VM' : 'CT';

  return (
    <>
      <GlowBorder
        color={flashColor === 'green' ? 'green' : flashColor === 'red' ? 'red' : 'amber'}
        intensity="medium"
        active={flashColor !== null}
      >
        <div className="bg-jarvis-bg-card border border-jarvis-amber/10 rounded-sm px-3 py-2 hover:bg-jarvis-bg-hover transition-colors group">
          {/* Top row: status + name + type badge + VMID */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot status={toStatusDotStatus(vm.status)} size="sm" />
              <span className="text-sm text-jarvis-text truncate">{vm.name || `VM ${vm.vmid}`}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-jarvis-bg-hover text-jarvis-text-dim font-mono uppercase">
                {typeBadge}
              </span>
            </div>
            <span className="text-xs text-jarvis-text-dim font-mono">{vm.vmid}</span>
          </div>

          {/* Second row: node + action buttons */}
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-jarvis-text-dim">{vm.node}</span>

            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {(vm.status === 'stopped' || vm.status === 'paused') && (
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="text-[10px] px-2 py-0.5 rounded bg-jarvis-green/10 text-jarvis-green border border-jarvis-green/20 hover:bg-jarvis-green/20 disabled:opacity-50 transition-colors font-display uppercase tracking-wider"
                >
                  Start
                </button>
              )}
              {vm.status === 'running' && (
                <>
                  <button
                    onClick={() => handleDestructiveAction('stop')}
                    disabled={loading}
                    className="text-[10px] px-2 py-0.5 rounded bg-jarvis-red/10 text-jarvis-red border border-jarvis-red/20 hover:bg-jarvis-red/20 disabled:opacity-50 transition-colors font-display uppercase tracking-wider"
                  >
                    Stop
                  </button>
                  <button
                    onClick={() => handleDestructiveAction('restart')}
                    disabled={loading}
                    className="text-[10px] px-2 py-0.5 rounded bg-jarvis-orange/10 text-jarvis-orange border border-jarvis-orange/20 hover:bg-jarvis-orange/20 disabled:opacity-50 transition-colors font-display uppercase tracking-wider"
                  >
                    Restart
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </GlowBorder>

      {/* Confirmation dialog for destructive actions */}
      <ConfirmDialog
        isOpen={confirm.open}
        title={`${confirm.action === 'stop' ? 'Stop' : 'Restart'} ${typeBadge}`}
        message={`Are you sure you want to ${confirm.action} ${vm.name || `VM ${vm.vmid}`}? This is a destructive operation that may interrupt running services.`}
        confirmLabel={confirm.action === 'stop' ? 'Stop' : 'Restart'}
        variant={confirm.action === 'stop' ? 'danger' : 'warning'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
});
