import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimelineStrip } from '../src/components/TimelineStrip';
import { usePhotoStore } from '../src/state/photoStore';
import type { PhotoRecord } from '../src/types';

function photo(id: string, takenAtISO?: string): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    takenAtISO,
  };
}

function resetStore() {
  usePhotoStore.setState({
    photos: new Map(),
    status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
    dateFilter: null,
    selectedPhotoId: null,
    searchFilters: {},
  });
}

describe('TimelineStrip calendar-axis navigation (evolves the existing density heatmap)', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to the original density-heatmap view with no calendar axis rendered', () => {
    render(<TimelineStrip photos={[photo('a', '2020-06-15T12:00:00.000Z')]} />);
    expect(screen.getByRole('button', { name: /browse by year/i })).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-calendar-axis')).not.toBeInTheDocument();
  });

  it('drills down year -> month -> day via the breadcrumb-driven calendar axis', () => {
    const photos = [
      photo('a', '2020-03-15T12:00:00.000Z'),
      photo('b', '2021-07-01T12:00:00.000Z'),
    ];
    render(<TimelineStrip photos={photos} />);

    fireEvent.click(screen.getByRole('button', { name: /browse by year/i }));
    const axis = screen.getByTestId('timeline-calendar-axis');
    expect(axis.children).toHaveLength(2); // 2020, 2021
    expect(screen.getByRole('button', { name: '2020' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2020' }));
    const monthAxis = screen.getByTestId('timeline-calendar-axis');
    expect(monthAxis.children).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Mar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mar' }));
    const dayAxis = screen.getByTestId('timeline-calendar-axis');
    expect(dayAxis.children).toHaveLength(31);
    // Breadcrumb now shows the drilled-down path.
    expect(screen.getByText('Mar')).toBeInTheDocument();
  });

  it('selecting a day bin applies it as the date filter (leaf-level behavior, same as before)', () => {
    const photos = [photo('a', '2020-03-15T12:00:00.000Z')];
    render(<TimelineStrip photos={photos} />);

    fireEvent.click(screen.getByRole('button', { name: /browse by year/i }));
    fireEvent.click(screen.getByRole('button', { name: '2020' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mar' }));
    fireEvent.click(screen.getByRole('button', { name: '15' }));

    expect(screen.getByRole('button', { name: /clear filter/i })).toBeInTheDocument();
  });

  it('"Density timeline" exits calendar mode back to the original default view', () => {
    render(<TimelineStrip photos={[photo('a', '2020-03-15T12:00:00.000Z')]} />);
    fireEvent.click(screen.getByRole('button', { name: /browse by year/i }));
    expect(screen.getByTestId('timeline-calendar-axis')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /density timeline/i }));
    expect(screen.queryByTestId('timeline-calendar-axis')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse by year/i })).toBeInTheDocument();
  });
});
