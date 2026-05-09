import { describe, expect, it } from 'vitest';
import { requiresAtcDeconfliction, shouldOfferAtc, trackHasAtcRequirement } from '../utils/atc';
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
    atc_called: false,
    atc_response_received: false,
    atc_required: false,
    ...overrides,
  };
}

describe('ATC deconfliction gating', () => {
  it('does not require ATC for normal C-UAS tracks just because IFF is unknown', () => {
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'commercial_quad' }))).toBe(false);
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'fixed_wing' }))).toBe(false);
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'shahed' }))).toBe(false);
  });

  it('does not require ATC before confirming known false alarms', () => {
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'bird' }))).toBe(false);
    expect(requiresAtcDeconfliction(makeTrack({ drone_type: 'weather_balloon' }))).toBe(false);
  });

  it('requires ATC only for tracks marked or inferred as controlled-airspace deconfliction contacts', () => {
    expect(requiresAtcDeconfliction(makeTrack({ atc_required: true, drone_type: 'passenger_aircraft' }))).toBe(true);
    expect(requiresAtcDeconfliction(makeTrack({ atc_required: undefined, drone_type: 'military_jet' }))).toBe(true);
    expect(trackHasAtcRequirement(makeTrack({ atc_required: true, drone_type: 'commercial_quad' }))).toBe(true);
  });

  it('does not require ATC once a response has been received', () => {
    expect(requiresAtcDeconfliction(makeTrack({ atc_required: true, atc_response_received: true }))).toBe(false);
  });

  it('does not offer repeat ATC calls once already called', () => {
    expect(shouldOfferAtc(makeTrack({ atc_required: true }))).toBe(true);
    expect(shouldOfferAtc(makeTrack({ atc_required: true, atc_called: true }))).toBe(false);
  });
});
