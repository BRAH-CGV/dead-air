// ─────────────────────────────────────────────
// CameraOverlay  –  the security monitor's frame over the camera's picture
// ─────────────────────────────────────────────
// The picture itself is on the monitor's screen in the world (FeedDisplay);
// this is what goes over it, laid onto that screen while the player leans
// in (ScreenView, #161): the camera's name, a REC
// mark, the flash indicator, the controls, a map of the base to click a
// camera on (setMap, onSelect), and CONNECTING while a switch waits long.
// The switch itself — the frozen frame and its grain — is drawn on the GPU
// (FeedDisplay's shader), not here.
//
//   overlay.show();
//   overlay.setCamera({ index: 0, count: 6, label: 'LIVING QUARTERS' });
//   overlay.setConnecting(true);   // a long wait for a camera to load
//
// Wraps #cctv in index.html (markup and styles live there, like the other
// overlays). Without a DOM every call is a no-op.
// ─────────────────────────────────────────────

/** Metres of plan kept round the map's edge, [across, down], unless the
 *  plan gives its own. */
const MAP_MARGIN = [1.5, 1.5];
/** Pixels: a camera's square on the map, and the gap kept between it and
 *  the wall it is pushed off. */
export const CAMERA_SQUARE = 18;
const MAP_GAP = 2;

export class CameraOverlay {
  /** @param {HTMLElement|null} [root]  Defaults to the page's #cctv. */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('cctv') : null) {
    this.root = root;
    this._label = root?.querySelector('#cctv-label') ?? null;
    this._hint  = root?.querySelector('#cctv-hint') ?? null;
    this._map   = root?.querySelector('#cctv-map') ?? null;
    /** The map's camera buttons, in camera order. @type {HTMLButtonElement[]} */
    this._camButtons = [];
    this._active = null;
    /** Called with a camera's index when its button on the map is clicked.
     *  @type {((index: number) => void)|null} */
    this.onSelect = null;
  }

  show() {
    this.root?.classList.add('is-on');
    if (this.root) this.root.ownerDocument.body.classList.add('cctv-on');
  }

  hide() {
    this.root?.classList.remove('is-on', 'is-flash', 'is-connecting');
    if (this.root) this.root.ownerDocument.body.classList.remove('cctv-on');
  }

  /** @param {{ index: number, count: number, label: string }} camera */
  setCamera({ index, count, label }) {
    if (this._label) this._label.textContent = `CAM ${index + 1}/${count} · ${label}`;
    this._active = index;
    this._camButtons.forEach((b, i) => b.classList.toggle('is-active', i === index));
  }

  /**
   * Draw the base's plan in the corner, FNAF style: a block per room, and a
   * button per camera where it hangs — clicking one calls onSelect(index).
   * Plan coordinates are the world's x and z, the back (−z, the window) at
   * the top, so it reads as the base seen from above, facing the desk's way.
   * @param {{ rooms: { label: string, x0: number, z0: number, x1: number, z1: number, outline?: boolean }[],
   *           cameras: { label: string, x: number, z: number, dir?: number[] }[],
   *           margin?: number[] }} plan  `margin`: metres of ground kept round
   *           the edge, [across, down].
   */
  setMap({ rooms = [], cameras = [], margin = MAP_MARGIN }) {
    const map = this._map;
    if (!map) return;
    map.replaceChildren();
    const xs = [...rooms.flatMap(r => [r.x0, r.x1]), ...cameras.map(c => c.x)];
    const zs = [...rooms.flatMap(r => [r.z0, r.z1]), ...cameras.map(c => c.z)];
    const [mx, mz] = margin;
    const minX = Math.min(...xs) - mx, spanX = Math.max(...xs) + mx - minX;
    const minZ = Math.min(...zs) - mz, spanZ = Math.max(...zs) + mz - minZ;
    const left = x => `${((x - minX) / spanX) * 100}%`;
    const top  = z => `${((z - minZ) / spanZ) * 100}%`;
    map.style.aspectRatio = `${spanX} / ${spanZ}`;

    const doc = map.ownerDocument;
    for (const room of rooms) {
      const el = doc.createElement('div');
      el.className = room.outline ? 'cctv-room is-outline' : 'cctv-room';
      el.textContent = room.label ?? '';
      Object.assign(el.style, {
        left: left(room.x0), top: top(room.z0),
        width: `${((room.x1 - room.x0) / spanX) * 100}%`, height: `${((room.z1 - room.z0) / spanZ) * 100}%`,
      });
      map.append(el);
    }
    this._camButtons = cameras.map((cam, i) => {
      const el = doc.createElement('button');
      el.type = 'button';
      el.className = 'cctv-cam';
      el.textContent = cam.label;
      el.style.left = left(cam.x);
      el.style.top = top(cam.z);
      el.style.width = el.style.height = `${CAMERA_SQUARE}px`;
      // Off its wall the way it faces — into its room, or out from the
      // building — far enough that the whole square clears the wall: half
      // the square's extent along `dir`, plus a hair.
      if (cam.dir) {
        const [dx, dz] = cam.dir;
        const off = (CAMERA_SQUARE / 2) * (Math.abs(dx) + Math.abs(dz)) + MAP_GAP;
        el.style.transform = `translate(calc(-50% + ${(dx * off).toFixed(2)}px), calc(-50% + ${(dz * off).toFixed(2)}px))`;
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelect?.(i);
      });
      map.append(el);
      return el;
    });
    if (this._active != null) this._camButtons.forEach((b, i) => b.classList.toggle('is-active', i === this._active));
  }

  /** A switch has been waiting long on a camera that is loading: say so,
   *  so a slow machine's wait reads as the feed connecting. */
  setConnecting(on) {
    this.root?.classList.toggle('is-connecting', !!on);
  }

  setFlash(on) {
    this.root?.classList.toggle('is-flash', !!on);
  }

  setHint(text) {
    if (this._hint) this._hint.textContent = text;
  }
}
