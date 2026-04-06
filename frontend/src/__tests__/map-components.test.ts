import { describe, it, expect } from "vitest";
import {
  shoelaceArea,
  verticesCentroid,
  polygonCentroid,
  degToRad,
} from "../components/map/mapGeometry";

describe("shoelaceArea", () => {
  it("calculates area of a 1x1 km square", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(shoelaceArea(vertices)).toBeCloseTo(1.0, 5);
  });

  it("calculates area of a 0.6x0.6 km square (small_fob default)", () => {
    const vertices = [
      { x: -0.3, y: -0.3 },
      { x: -0.3, y: 0.3 },
      { x: 0.3, y: 0.3 },
      { x: 0.3, y: -0.3 },
    ];
    expect(shoelaceArea(vertices)).toBeCloseTo(0.36, 5);
  });

  it("calculates area of a triangle", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(shoelaceArea(vertices)).toBeCloseTo(1.0, 5);
  });
});

describe("verticesCentroid", () => {
  it("returns center of a symmetric square", () => {
    const vertices = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const c = verticesCentroid(vertices);
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.y).toBeCloseTo(0, 5);
  });

  it("returns offset centroid for non-symmetric polygon", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    const c = verticesCentroid(vertices);
    expect(c.x).toBeCloseTo(4 / 3, 4);
    expect(c.y).toBeCloseTo(2 / 3, 4);
  });
});

describe("polygonCentroid", () => {
  it("returns centroid of number[][] polygon", () => {
    const polygon = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const [cx, cy] = polygonCentroid(polygon);
    expect(cx).toBeCloseTo(2, 5);
    expect(cy).toBeCloseTo(2, 5);
  });
});

describe("degToRad", () => {
  it("converts 0 degrees to 0 radians", () => {
    expect(degToRad(0)).toBe(0);
  });

  it("converts 180 degrees to PI", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
  });

  it("converts 90 degrees to PI/2", () => {
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("converts 360 degrees to 2*PI", () => {
    expect(degToRad(360)).toBeCloseTo(2 * Math.PI, 10);
  });
});
