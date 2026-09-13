import { describe, expect, test } from "bun:test";
import { ZOOM_LEVELS, ZOOM_NODE, ZOOM_PATTERN, ZOOM_UNIT, nextZoom, zoomLabel } from "./zoom";

describe("zoom language", () => {
  test("cycles unit → pattern → node → unit", () => {
    expect(ZOOM_LEVELS).toBe(3);
    expect(nextZoom(ZOOM_UNIT)).toBe(ZOOM_PATTERN);
    expect(nextZoom(ZOOM_PATTERN)).toBe(ZOOM_NODE);
    expect(nextZoom(ZOOM_NODE)).toBe(ZOOM_UNIT);
    expect(zoomLabel(ZOOM_UNIT)).toBe("unit");
    expect(zoomLabel(ZOOM_PATTERN)).toBe("pattern");
    expect(zoomLabel(ZOOM_NODE)).toBe("node");
  });
});
