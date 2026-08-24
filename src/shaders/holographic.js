/**
 * Holographic shader — pulsing glow effect for the signal receiver.
 * Custom vertex + fragment shaders with time-driven uniforms.
 *
 * Inspired by the signal-tuning aesthetic of Voices of the Void.
 */

export const holographicVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const holographicFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // fresnel-like rim glow
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.0);

    // pulsing scanlines
    float scanline = sin(vNormal.y * 30.0 + uTime * 3.0) * 0.5 + 0.5;
    scanline = smoothstep(0.3, 0.7, scanline);

    // combine
    float pulse = sin(uTime * 2.0) * 0.15 + 0.85;
    float alpha = (fresnel * 0.7 + scanline * 0.3) * uIntensity * pulse;

    gl_FragColor = vec4(uColor * alpha * 1.5, alpha * 0.8);
  }
`;

export function createHolographicUniforms() {
  return {
    uTime: { value: 0.0 },
    uColor: { value: { r: 0.13, g: 0.8, b: 0.53 } }, // green glow
    uIntensity: { value: 1.0 },
  };
}

export function updateHolographicUniforms(uniforms, dt) {
  uniforms.uTime.value += dt;
}
