import type { MapStyleId } from '../lib/mapStyles';
import './MapStyleToggle.css';

interface MapStyleToggleProps {
  active: MapStyleId;
  onChange: (style: MapStyleId) => void;
}

/** Small on-map control switching between the Detailed and Treasure Map basemap styles. */
export function MapStyleToggle({ active, onChange }: MapStyleToggleProps) {
  return (
    <div className="map-style-toggle" data-testid="map-style-toggle">
      <button
        type="button"
        className={`map-style-toggle__button ${active === 'detailed' ? 'map-style-toggle__button--active' : ''}`}
        aria-pressed={active === 'detailed'}
        onClick={() => onChange('detailed')}
      >
        Detailed
      </button>
      <button
        type="button"
        className={`map-style-toggle__button ${active === 'treasure' ? 'map-style-toggle__button--active' : ''}`}
        aria-pressed={active === 'treasure'}
        onClick={() => onChange('treasure')}
      >
        Treasure Map
      </button>
    </div>
  );
}
