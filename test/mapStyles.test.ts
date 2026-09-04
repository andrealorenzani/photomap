import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMapStyles, loadStoredMapStyle, saveMapStylePreference } from '../src/lib/mapStyles';

describe('mapStyles', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.__PHOTOMAP_CONFIG__;
  });

  afterEach(() => {
    localStorage.clear();
    delete window.__PHOTOMAP_CONFIG__;
  });

  it('defaults to Detailed on first load with no stored preference', () => {
    expect(loadStoredMapStyle()).toBe('detailed');
  });

  it('persists the chosen style to localStorage and round-trips it', () => {
    saveMapStylePreference('treasure');
    expect(loadStoredMapStyle()).toBe('treasure');
    saveMapStylePreference('detailed');
    expect(loadStoredMapStyle()).toBe('detailed');
  });

  it('ignores garbage localStorage values and falls back to Detailed', () => {
    localStorage.setItem('photomap.mapStyle', 'nonsense');
    expect(loadStoredMapStyle()).toBe('detailed');
  });

  it('Detailed and Treasure Map use the same tile URL by default (same OSM source, coordinates always line up)', () => {
    const styles = getMapStyles();
    expect(styles.detailed.tileUrl).toBe(styles.treasure.tileUrl);
  });

  it("Treasure Map's maxZoom is capped well below Detailed's (country/region-level, automatable guard: below 12)", () => {
    const styles = getMapStyles();
    expect(styles.treasure.maxZoom).toBeLessThan(12);
    expect(styles.treasure.maxZoom).toBeLessThan(styles.detailed.maxZoom);
  });

  it('Detailed has no CSS filter; Treasure Map has one', () => {
    const styles = getMapStyles();
    expect(styles.detailed.cssFilter).toBeUndefined();
    expect(styles.treasure.cssFilter).toBeTruthy();
  });

  it('values are config-driven (read from window.__PHOTOMAP_CONFIG__), not hardcoded literals', () => {
    window.__PHOTOMAP_CONFIG__ = {
      mapTileUrlDetailed: 'https://custom.example/{z}/{x}/{y}.png',
      mapMaxZoomTreasure: 7,
      mapTreasureCssFilter: 'grayscale(1)',
    };
    const styles = getMapStyles();
    expect(styles.detailed.tileUrl).toBe('https://custom.example/{z}/{x}/{y}.png');
    expect(styles.treasure.maxZoom).toBe(7);
    expect(styles.treasure.cssFilter).toBe('grayscale(1)');
  });
});
