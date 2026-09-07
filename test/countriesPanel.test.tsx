import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CountriesPanel } from '../src/components/CountriesPanel';
import * as countries from '../src/lib/countries';
import type { PhotoRecord } from '../src/types';

function photo(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    ...overrides,
  };
}

describe('CountriesPanel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the expected list of countries and visit dates once loaded', async () => {
    vi.spyOn(countries, 'loadCountryBoundaries').mockResolvedValue([]);
    vi.spyOn(countries, 'computeCountryVisits').mockReturnValue([
      { countryName: 'France', visits: [{ year: 2019, month: 6 }, { year: 2021, month: 8 }] },
      { countryName: 'Japan', visits: [{ year: 2020, month: 1 }] },
    ]);

    render(<CountriesPanel photos={[photo('p1', { hasGPS: true, lat: 1, lon: 1 })]} />);

    await waitFor(() => expect(screen.getByTestId('countries-panel')).toBeInTheDocument());
    expect(screen.getByText('France')).toBeInTheDocument();
    expect(screen.getByText('Jun 2019, Aug 2021')).toBeInTheDocument();
    expect(screen.getByText('Japan')).toBeInTheDocument();
    expect(screen.getByText('Jan 2020')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Countries visited \(2\)/ })).toBeInTheDocument();
  });

  it('toggles the list open/closed', async () => {
    vi.spyOn(countries, 'loadCountryBoundaries').mockResolvedValue([]);
    vi.spyOn(countries, 'computeCountryVisits').mockReturnValue([
      { countryName: 'France', visits: [{ year: 2019, month: 6 }] },
    ]);

    render(<CountriesPanel photos={[photo('p1', { hasGPS: true, lat: 1, lon: 1 })]} />);

    await waitFor(() => expect(screen.getByText('France')).toBeInTheDocument());
    const toggle = screen.getByRole('button', { name: /Countries visited/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('France')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('France')).toBeInTheDocument();
  });

  it('renders nothing when there are no country visits', async () => {
    vi.spyOn(countries, 'loadCountryBoundaries').mockResolvedValue([]);
    vi.spyOn(countries, 'computeCountryVisits').mockReturnValue([]);

    const { container } = render(<CountriesPanel photos={[]} />);

    await waitFor(() => expect(countries.loadCountryBoundaries).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
