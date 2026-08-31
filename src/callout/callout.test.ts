import { describe, it, expect } from "vitest";
import { frameRects, placeBubble, type Rect } from "./callout";

describe("callout.ts", () => {
  describe("frameRects", () => {
    it("returns single full rect when hole is null", () => {
      const viewport: Rect = { top: 0, left: 0, width: 100, height: 100 };
      const rects = frameRects(null, viewport);
      expect(rects).toHaveLength(1);
      expect(rects[0]).toEqual(viewport);
    });

    it("returns 4 frames when hole is centered", () => {
      const viewport: Rect = { top: 0, left: 0, width: 100, height: 100 };
      const hole: Rect = { top: 40, left: 40, width: 20, height: 20 };
      const rects = frameRects(hole, viewport);
      expect(rects).toHaveLength(4);

      // Top frame
      expect(rects[0]).toEqual({ top: 0, left: 0, width: 100, height: 40 });

      // Bottom frame
      expect(rects[1]).toEqual({ top: 60, left: 0, width: 100, height: 40 });

      // Left frame
      expect(rects[2]).toEqual({ top: 40, left: 0, width: 40, height: 20 });

      // Right frame
      expect(rects[3]).toEqual({ top: 40, left: 60, width: 40, height: 20 });
    });

    it("skips degenerate top frame when hole touches viewport top", () => {
      const viewport: Rect = { top: 0, left: 0, width: 100, height: 100 };
      const hole: Rect = { top: 0, left: 40, width: 20, height: 50 };
      const rects = frameRects(hole, viewport);
      expect(rects.length).toBeLessThan(4);
      expect(rects.every((r) => r.height > 0 && r.width > 0)).toBe(true);
    });

    it("skips degenerate frames when hole fills viewport", () => {
      const viewport: Rect = { top: 0, left: 0, width: 100, height: 100 };
      const hole: Rect = { top: 0, left: 0, width: 100, height: 100 };
      const rects = frameRects(hole, viewport);
      expect(rects).toHaveLength(0);
    });
  });

  describe("placeBubble", () => {
    const viewport: Rect = { top: 0, left: 0, width: 1000, height: 800 };
    const bubble = { width: 300, height: 200 };
    const gap = 12;

    it("places bubble above anchor when space available", () => {
      const anchor: Rect = { top: 400, left: 400, width: 50, height: 50 };
      const result = placeBubble(anchor, bubble, viewport, "top", gap);

      expect(result.placement).toBe("top");
      expect(result.top).toBeLessThan(anchor.top); // above
      expect(result.top + bubble.height + gap).toBeLessThanOrEqual(anchor.top);
    });

    it("places bubble below anchor when top would overflow", () => {
      const anchor: Rect = { top: 50, left: 400, width: 50, height: 50 };
      const result = placeBubble(anchor, bubble, viewport, "top", gap);

      expect(result.placement).toBe("bottom");
      expect(result.top).toBeGreaterThan(anchor.top + anchor.height);
    });

    it("centers on a null anchor", () => {
      const result = placeBubble(null, bubble, viewport, "top", gap);

      expect(result.placement).toBe("center");
      expect(result.top).toBeCloseTo(viewport.top + (viewport.height - bubble.height) / 2);
      expect(result.left).toBeCloseTo(viewport.left + (viewport.width - bubble.width) / 2);
    });

    it("uses sheet mode on narrow viewport", () => {
      const narrowViewport: Rect = { top: 0, left: 0, width: 400, height: 800 };
      const anchor: Rect = { top: 400, left: 200, width: 50, height: 50 };

      const result = placeBubble(anchor, bubble, narrowViewport, "top", gap);

      expect(result.placement).toBe("sheet");
    });

    it("clamps bubble into viewport margins", () => {
      const bubble2 = { width: 900, height: 200 };
      const anchor: Rect = { top: 400, left: 50, width: 50, height: 50 };

      const result = placeBubble(anchor, bubble2, viewport, "top", gap);

      expect(result.left).toBeGreaterThanOrEqual(viewport.left + 16); // MARGIN = 16
      expect(result.left + bubble2.width).toBeLessThanOrEqual(
        viewport.left + viewport.width - 16,
      );
    });

    it("calculates arrow offset for horizontal placements", () => {
      const anchor: Rect = { top: 400, left: 500, width: 50, height: 50 };
      const result = placeBubble(anchor, bubble, viewport, "top", gap);

      // Arrow offset should be within reasonable bounds
      expect(result.arrowOffset).toBeLessThanOrEqual(10);
      expect(result.arrowOffset).toBeGreaterThanOrEqual(-10);
    });

    it("places bubble to the right when requested", () => {
      const anchor: Rect = { top: 400, left: 600, width: 50, height: 50 };
      const result = placeBubble(anchor, bubble, viewport, "right", gap);

      if (result.placement === "right") {
        expect(result.left).toBeGreaterThan(anchor.left + anchor.width);
      }
    });
  });
});
