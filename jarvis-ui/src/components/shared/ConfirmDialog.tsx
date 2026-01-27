import { useEffect, useCallback } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant: 'warning' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  /** PERF-024/026: Use CSS var shadow tokens instead of hardcoded rgba */
  const confirmColor =
    variant === 'danger'
      ? 'bg-jarvis-red hover:bg-jarvis-red/80'
      : 'bg-jarvis-orange hover:bg-jarvis-orange/80';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="bg-jarvis-bg-panel border border-jarvis-amber/30 rounded-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-jarvis-amber text-lg uppercase tracking-wider mb-3">
          {title}
        </h3>
        <p className="text-jarvis-text text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-jarvis-text-dim/30 text-jarvis-text-dim rounded hover:bg-jarvis-bg-hover transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm text-white font-semibold rounded transition-all hover:shadow-lg ${confirmColor}`}
            style={{ boxShadow: variant === 'danger' ? 'var(--shadow-jarvis-glow-red-sm)' : 'var(--shadow-jarvis-glow-orange)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
