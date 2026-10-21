// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CameraOverlay, CAMERA_SQUARE } from './CameraOverlay.js';

// ─────────────────────────────────────────────
// CameraOverlay  –  the security monitor's frame, label and static
// ─────────────────────────────────────────────

function markup() {
  document.body.innerHTML = `
    <div id="cctv">
      <div id="cctv-label"></div>
      <div id="cctv-connecting">CONNECTING…</div>
      <div id="cctv-flash"></div>
      <div id="cctv-hint"></div>
      <div id="cctv-map"></div>
    </div>`;
  return document.getElementById('cctv');
}

describe('CameraOverlay', () => {
  let root, overlay;
  beforeEach(() => {
    root = markup();
    overlay = new CameraOverlay(root);
  });

  it('is hidden until shown, and marks the page while it is up', () => {
    expect(root.classList.contains('is-on')).toBe(false);
    overlay.show();
    expect(root.classList.contains('is-on')).toBe(true);
    expect(document.body.classList.contains('cctv-on')).toBe(true);
    overlay.hide();
    expect(root.classList.contains('is-on')).toBe(false);
    expect(document.body.classList.contains('cctv-on')).toBe(false);
  });

  it('names the camera on screen, numbered out of how many there are', () => {
    overlay.setCamera({ index: 2, count: 6, label: 'YARD WEST' });
    expect(document.getElementById('cctv-label').textContent).toBe('CAM 3/6 · YARD WEST');
  });

  it('says CONNECTING only while a switch is waiting long', () => {
    expect(root.classList.contains('is-connecting')).toBe(false);
    overlay.setConnecting(true);
    expect(root.classList.contains('is-connecting')).toBe(true);
    overlay.setConnecting(false);
    expect(root.classList.contains('is-connecting')).toBe(false);
  });

  it('has no static of its own: the switch is drawn on the GPU (FeedDisplay)', () => {
    expect(overlay.setLive).toBeUndefined();
    expect(overlay.tick).toBeUndefined();
  });

  it('drops CONNECTING when it is hidden', () => {
    overlay.show();
    overlay.setConnecting(true);
    overlay.hide();
    expect(root.classList.contains('is-connecting')).toBe(false);
  });

  it('shows when the flash is lit', () => {
    overlay.setFlash(true);
    expect(root.classList.contains('is-flash')).toBe(true);
    overlay.setFlash(false);
    expect(root.classList.contains('is-flash')).toBe(false);
  });

  it('prints the controls', () => {
    overlay.setHint('A/D: pan');
    expect(document.getElementById('cctv-hint').textContent).toBe('A/D: pan');
  });

  describe('the map', () => {
    // Plan coordinates are the world's x and z: −z (the back, the window) at the top.
    const plan = {
      rooms: [
        { label: 'OFFICE', x0: -6, z0: -5, x1: 6, z1: 5 },
        { label: 'YARD', x0: -10, z0: 5, x1: 10, z1: 15, outline: true },
      ],
      cameras: [
        { label: 'CAM 1', x: -5, z: -4 },
        { label: 'CAM 2', x: 5, z: 10 },
      ],
    };
    const map = () => document.getElementById('cctv-map');
    const buttons = () => [...map().querySelectorAll('.cctv-cam')];

    beforeEach(() => overlay.setMap(plan));

    it('draws a block for each room, placed by its plan, the back at the top', () => {
      const rooms = [...map().querySelectorAll('.cctv-room')];
      expect(rooms.map(r => r.textContent)).toEqual(['OFFICE', 'YARD']);
      const [office, yard] = rooms;
      expect(parseFloat(office.style.top)).toBeLessThan(parseFloat(yard.style.top));
      expect(yard.classList.contains('is-outline')).toBe(true);
    });

    it('puts a button for every camera where it hangs', () => {
      expect(buttons().map(b => b.textContent)).toEqual(['CAM 1', 'CAM 2']);
      const [a, b] = buttons();
      expect(parseFloat(a.style.left)).toBeLessThan(parseFloat(b.style.left));
      expect(parseFloat(a.style.top)).toBeLessThan(parseFloat(b.style.top));
    });

    it('clicking a camera picks it', () => {
      const picked = [];
      overlay.onSelect = i => picked.push(i);
      buttons()[1].click();
      expect(picked).toEqual([1]);
    });

    it('lights up the camera on screen', () => {
      overlay.setCamera({ index: 1, count: 2, label: 'X' });
      expect(buttons().map(b => b.classList.contains('is-active'))).toEqual([false, true]);
    });

    it('a wider margin across leaves room beside the building', () => {
      const room = () => map().querySelector('.cctv-room');
      const leftOf = () => parseFloat(room().style.left);
      const before = leftOf();
      overlay.setMap({ ...plan, margin: [8, 1.5] });
      expect(leftOf()).toBeGreaterThan(before);
    });

    it("pushes a camera's square off its wall the way it faces, so the whole square clears the wall", () => {
      overlay.setMap({ ...plan, cameras: [
        { label: '1', x: 0, z: 0, dir: [0, 1] },                    // facing +z: down the map
        { label: '2', x: 0, z: 0, dir: [-Math.SQRT1_2, Math.SQRT1_2] },   // into a corner's room, diagonal
        { label: '3', x: 0, z: 0 },                                  // no facing: centred
      ] });
      const [down, diag, centred] = buttons().map(b => b.style.transform);
      const shift = t => t.match(/calc\(-50% \+ (-?[\d.]+)px\), calc\(-50% \+ (-?[\d.]+)px\)/).slice(1).map(Number);
      const half = CAMERA_SQUARE / 2;
      // Straight down: by more than half the square, and not sideways.
      expect(shift(down)[0]).toBeCloseTo(0);
      expect(shift(down)[1]).toBeGreaterThan(half);
      // Diagonal: far enough that the square's nearest corner clears both walls.
      const [dx, dy] = shift(diag);
      expect(dx).toBeLessThan(-half);
      expect(dy).toBeGreaterThan(half);
      expect(centred).toBe('');
    });

    it('a second plan replaces the first', () => {
      overlay.setMap(plan);
      expect(buttons()).toHaveLength(2);
    });
  });

  it('every call is a no-op without the markup', () => {
    const bare = new CameraOverlay(null);
    expect(() => {
      bare.show(); bare.setCamera({ index: 0, count: 1, label: 'X' });
      bare.setConnecting(true); bare.setFlash(true); bare.setHint(''); bare.setMap({ rooms: [], cameras: [] }); bare.hide();
    }).not.toThrow();
  });
});

// The overlay is laid out at the monitor's own size and painted onto it
// (#161), so the map is sized as a share of the monitor — never of the
// browser window — and kept to a corner of it.
describe('the map\'s size on the monitor (index.html)', () => {
  it('is a fixed share of the monitor\'s width, small enough to leave the picture clear', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const rule = html.match(/#cctv-map\s*\{([^}]*)\}/)[1];
    const width = rule.match(/width:\s*([^;]+);/)[1].trim();
    expect(width).toMatch(/^\d+(\.\d+)?%$/);
    expect(parseFloat(width)).toBeLessThanOrEqual(30);
  });

  it('its camera buttons are small squares', () => {
    expect(CAMERA_SQUARE).toBeLessThanOrEqual(20);
  });
});
