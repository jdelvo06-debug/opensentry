import { describe, expect, it } from 'vitest';
import { requiresAtcDeconfliction } from '../utils/atc';
import type { TrackData } from '../types';

function makeTrack(overrides: Partial<TrackData> = {}): TrackData {
  return {
    id: 'track-1',
    display_label: 'TRN-001',
    dtid_phase: 'detected',
    affiliation: 'unknown',
    x: 0,
    y: 0,
    altitude_ft: 100,
    speed_kts: 20,
    heading_deg: 0,
    confidence: 0.5,
    classification: null,
    drone_type: 'commercial_quad',
    trail: [],
    sensors_detecting: [],
    neutralized: false,
    iff_status: 'unknown',
    atc_response_received: false,
    ...overrides,
  };
}

describe('ATC deconfliction gating', () => {
  it('does not require ATC before confirming known false alarms', () => {
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'bird' }))).toBe(false);
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'weather_balloon' }))).toBe(false);
  });

  it('still requires ATC for non-exempt unknown tracks', () => {
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'fixed_wing' }))).toBe(true);
  });

  it('does not require ATC once a response has been received', () => {
    expect(requiresAtcDeconfliction(makeTrack({ atc_response_received: true }))).toBe(false);
  });
});
