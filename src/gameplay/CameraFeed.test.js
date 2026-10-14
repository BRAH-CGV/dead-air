import { describe, it, expect } from 'vitest';
import { CameraFeed, CCTV } from './CameraFeed.js';

// ─────────────────────────────────────────────
// CameraFeed  –  which security camera is on screen, where it points, and
// whether the picture is through yet
// ─────────────────────────────────────────────

const CAMS = [
  { name: 'A', panRange: 0.5, zones: ['interior'] },
  { name: 'B', panRange: 1.0, zones: ['yard'] },
  { name: 'C', panRange: 0.2, zones: ['yard', 'unseen'] },
];

function run(feed, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += step) feed.update(step);
}

describe('CameraFeed', () => {
  it('starts closed, on the first camera', () => {
    const feed = new CameraFeed({ cameras: CAMS });
    expect(feed.active).toBe(false);
    expect(feed.index).toBe(0);
    expect(feed.camera).toBe(CAMS[0]);
  });

  it('opens on the camera last watched', () => {
    const feed = new CameraFeed({ cameras: CAMS });
    feed.open();
    feed.select(2);
    feed.close();
    feed.open();
    expect(feed.active).toBe(true);
    expect(feed.index).toBe(2);
  });

  it('next and prev step through the cameras and wrap round', () => {
    const feed = new CameraFeed({ cameras: CAMS });
    feed.open();
    feed.prev();
    expect(feed.index).toBe(2);
    feed.next();
    expect(feed.index).toBe(0);
    feed.next();
    expect(feed.index).toBe(1);
  });

  it('ignores a camera number it does not have', () => {
    const feed = new CameraFeed({ cameras: CAMS });
    feed.open();
    feed.select(1);
    feed.select(7);
    expect(feed.index).toBe(1);
  });

  describe('static', () => {
    it('shows static for at least minStatic on opening, even when everything is ready', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      expect(feed.live).toBe(false);
      run(feed, CCTV.minStatic * 0.8);
      expect(feed.live).toBe(false);
      run(feed, CCTV.minStatic * 0.4);
      expect(feed.live).toBe(true);
    });

    it('stays static until every zone the camera sees is ready', () => {
      const ready = new Set();
      const feed = new CameraFeed({ cameras: CAMS, isReady: name => ready.has(name) });
      feed.open();
      feed.select(2);
      run(feed, CCTV.minStatic * 3);
      expect(feed.live).toBe(false);
      ready.add('yard');
      feed.update(1 / 60);
      expect(feed.live).toBe(false);   // 'unseen' still loading
      ready.add('unseen');
      feed.update(1 / 60);
      expect(feed.live).toBe(true);
    });

    it('gives up waiting after maxStatic, so a stuck load can never black out a camera', () => {
      const feed = new CameraFeed({ cameras: CAMS, isReady: () => false });
      feed.open();
      run(feed, CCTV.maxStatic + 0.05);
      expect(feed.live).toBe(true);
    });

    it('cuts back to static on every switch', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      run(feed, CCTV.minStatic * 2);
      expect(feed.live).toBe(true);
      feed.next();
      expect(feed.live).toBe(false);
    });

    it('does nothing while closed', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      run(feed, 1);
      expect(feed.live).toBe(false);
    });
  });

  describe('panning', () => {
    it('turns at panRate, clamped to the camera’s own range', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      feed.pan(1, 0.1);
      expect(feed.panOf(0)).toBeCloseTo(CCTV.panRate * 0.1);
      feed.pan(1, 10);
      expect(feed.panOf(0)).toBeCloseTo(0.5);
      feed.pan(-1, 10);
      expect(feed.panOf(0)).toBeCloseTo(-0.5);
    });

    it('keeps to a camera’s own panLimits when it has them, uneven either way', () => {
      const feed = new CameraFeed({ cameras: [{ panRange: 1, panLimits: [-1, 0.3] }] });
      feed.open();
      feed.pan(1, 10);
      expect(feed.panOf(0)).toBeCloseTo(0.3);
      feed.pan(-1, 10);
      expect(feed.panOf(0)).toBeCloseTo(-1);
    });

    it('each camera keeps where it was left', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      feed.pan(1, 10);
      feed.next();
      expect(feed.panOf(1)).toBe(0);
      feed.prev();
      expect(feed.panOf(0)).toBeCloseTo(0.5);
    });

    it('does not pan while closed', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.pan(1, 1);
      expect(feed.panOf(0)).toBe(0);
    });
  });

  describe('flash', () => {
    it('toggles while watching', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      expect(feed.flash).toBe(false);
      feed.toggleFlash();
      expect(feed.flash).toBe(true);
      feed.toggleFlash();
      expect(feed.flash).toBe(false);
    });

    it('goes out when the view moves to another camera', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      feed.toggleFlash();
      feed.next();
      expect(feed.flash).toBe(false);
    });

    it('goes out when the cameras are closed', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.open();
      feed.toggleFlash();
      feed.close();
      expect(feed.flash).toBe(false);
      feed.open();
      expect(feed.flash).toBe(false);
    });

    it('cannot be lit while closed', () => {
      const feed = new CameraFeed({ cameras: CAMS });
      feed.toggleFlash();
      expect(feed.flash).toBe(false);
    });
  });
});
