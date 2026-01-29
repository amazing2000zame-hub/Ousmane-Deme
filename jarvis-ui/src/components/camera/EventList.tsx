import { useState, useEffect, useCallback } from 'react';
import { EventRow } from './EventRow';
import { EventFilters } from './EventFilters';
import { useCameraStore, type FrigateEvent } from '../../stores/camera';
import { useAuthStore } from '../../stores/auth';

interface EventListProps {
  maxEvents?: number;
  pollInterval?: number;
}

/**
 * Recent events list with thumbnail previews and face labels.
 * Polls for new events at the specified interval.
 * Provides camera and object type filtering.
 */
export function EventList({
  maxEvents = 15,
  pollInterval = 10000,
}: EventListProps) {
  const cameras = useCameraStore((s) => s.cameras);
  const token = useAuthStore((s) => s.token);
  const [events, setEvents] = useState<FrigateEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cameraFilter, setCameraFilter] = useState<string | null>(null);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!token) return;

    const params = new URLSearchParams();
    params.set('limit', String(maxEvents));
    params.set('has_snapshot', '1');
    if (cameraFilter) params.set('camera', cameraFilter);
    if (labelFilter) params.set('label', labelFilter);

    try {
      const res = await fetch(`/api/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (e) {
      console.error('Failed to fetch events:', e);
    } finally {
      setLoading(false);
    }
  }, [token, maxEvents, cameraFilter, labelFilter]);

  // Initial fetch + polling
  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, pollInterval);
    return () => clearInterval(id);
  }, [fetchEvents, pollInterval]);

  return (
    <div>
      <EventFilters
        cameras={cameras}
        selectedCamera={cameraFilter}
        selectedLabel={labelFilter}
        onCameraChange={setCameraFilter}
        onLabelChange={setLabelFilter}
      />

      {loading ? (
        <div className="text-center text-jarvis-text-dim py-4 text-xs">
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <div className="text-center text-jarvis-text-dim py-4 text-xs">
          No recent events
        </div>
      ) : (
        <div className="space-y-0">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
