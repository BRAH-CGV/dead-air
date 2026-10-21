import * as THREE from 'three';

// ─────────────────────────────────────────────
// ScreenGlass  –  every screen's glass, on the GPU (#161)
// ─────────────────────────────────────────────
// What makes a picture read as a monitor: scanlines crawling slowly down
// and a darker edge. Drawn in the fragment shader, so a repaint of the
// picture costs nothing extra for it — the camera monitor's shader
// (FeedDisplay) and the computer's and console's (createScreenMaterial,
// for ScreenCanvas) share it, so all three screens wear the same glass.
//
//   gl_FragColor.rgb *= screenGlass(vUv);   // in display space, after
//                                           // <colorspace_fragment>
//
// Scanlines are a share of the screen (SCANLINES down it), not of the
// picture's pixels, so the screen looks the same drawn small or leaned in
// to. uTime makes them crawl.
// ─────────────────────────────────────────────

export const SCREEN_GLASS_GLSL = /* glsl */ `
  #define SCANLINES 128.0
  float screenGlass(vec2 uv) {
    float scan = 0.86 + 0.14 * step(0.334, fract(uv.y * SCANLINES - uTime * 0.6));
    vec2 edge = uv * (1.0 - uv);
    float vignette = clamp(pow(edge.x * edge.y * 16.0, 0.25), 0.0, 1.0);
    return scan * mix(0.45, 1.0, vignette);
  }
`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tPicture;
  uniform float uHasPicture;
  uniform float uAspect;   // the screen's width over its height
  uniform float uCorner;   // its corner radius, a share of its height
  uniform float uTime;
  varying vec2 vUv;
  ${SCREEN_GLASS_GLSL}

  void main() {
    // The rounded corners: outside them, nothing (cut, not blended, so the
    // screen never needs sorting).
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec2 q = abs(p) - vec2(0.5 * uAspect - uCorner, 0.5 - uCorner);
    if (uCorner > 0.0 && length(max(q, 0.0)) > uCorner) discard;

    vec3 col = uHasPicture > 0.5 ? texture2D(tPicture, vUv).rgb : vec3(0.002);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= screenGlass(vUv);
  }
`;

/**
 * A screen showing `picture` (a ScreenCanvas's), with its glass.
 * @param {{ picture: THREE.Texture|null, aspect: number, corner?: number }} opts
 */
export function createScreenMaterial({ picture, aspect, corner = 0 }) {
  return new THREE.ShaderMaterial({
    name: 'ScreenGlass',
    uniforms: {
      tPicture: { value: picture },
      uHasPicture: { value: picture ? 1 : 0 },
      uAspect: { value: aspect },
      uCorner: { value: corner },
      uTime: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    // The picture glows at the colours painted.
    toneMapped: false,
  });
}
