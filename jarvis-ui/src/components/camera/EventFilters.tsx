interface EventFiltersProps {
  cameras: string[];
  selectedCamera: string | null;
  selectedLabel: string | null;
  onCameraChange: (camera: string | null) => void;
  onLabelChange: (label: string | null) => void;
}

const LABELS = ['person', 'car', 'dog', 'cat', 'package'];

/**
 * Camera and object type filter dropdowns for event list.
 */
export function EventFilters({
  cameras,
  selectedCamera,
  selectedLabel,
  onCameraChange,
  onLabelChange,
}: EventFiltersProps) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {/* Camera filter */}
      <select
        value={selectedCamera ?? ''}
        onChange={(e) => onCameraChange(e.target.value || null)}
        className="text-[10px] bg-jarvis-bg-hover border border-jarvis-amber/20 rounded px-1.5 py-1 text-jarvis-text focus:outline-none focus:border-jarvis-amber/40"
      >
        <option value="">All Cameras</option>
        {cameras.map((cam) => (
          <option key={cam} value={cam}>
            {cam.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>

      {/* Label filter */}
      <select
        value={selectedLabel ?? ''}
        onChange={(e) => onLabelChange(e.target.value || null)}
        className="text-[10px] bg-jarvis-bg-hover border border-jarvis-amber/20 rounded px-1.5 py-1 text-jarvis-text focus:outline-none focus:border-jarvis-amber/40"
      >
        <option value="">All Objects</option>
        {LABELS.map((label) => (
          <option key={label} value={label}>
            {label.charAt(0).toUpperCase() + label.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
