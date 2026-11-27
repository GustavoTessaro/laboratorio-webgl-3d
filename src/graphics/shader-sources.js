const vertex = (deform = '', vary = '') => `
varying vec2 vUv;
${vary}
${deform ? 'uniform float uAmplitude, uFrequency, uPhase;' : ''}
void main() {
  vec3 point = position;
  ${deform}
  vec4 view = modelViewMatrix * vec4(point, 1.0);
  vUv = uv;
  ${vary ? 'vPosition = position; vView = -view.xyz; vNormal = normalMatrix * normal;' : ''}
  gl_Position = projectionMatrix * view;
}
`.trim();

const vectors = 'varying vec3 vNormal, vView, vPosition;';
const angle = `
float rim(float power) {
  vec3 sight = isOrthographic ? vec3(0.0, 0.0, 1.0) : vView * inversesqrt(max(dot(vView, vView), 1e-8));
  vec3 n = vNormal * inversesqrt(max(dot(vNormal, vNormal), 1e-8));
  if (!gl_FrontFacing) n = -n;
  return pow(1.0 - clamp(dot(n, sight), 0.0, 1.0), power);
}
`;
const noise = `
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 t = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), t.x),
             mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), t.x), t.y);
}
`;

const effects = {
  gradient: {
    uniforms: 'uniform float uDirection;',
    body: `vec2 direction = vec2(cos(uDirection), sin(uDirection));
    float value = clamp(dot(vUv - 0.5, direction) + 0.5, 0.0, 1.0);`,
  },
  wave: {
    deform: 'point.y += uAmplitude * sin(uFrequency * (point.x + 0.65 * point.z) + uPhase);',
    body: 'float value = smoothstep(0.0, 1.0, vUv.y);',
  },
  checker: {
    uniforms: 'uniform float uScale;',
    body: 'vec2 cell = floor(vUv * uScale); float value = mod(cell.x + cell.y, 2.0);',
  },
  fresnel: {
    vary: vectors, utils: angle,
    uniforms: 'uniform float uPower, uIntensity;',
    body: 'float value = clamp(rim(uPower) * uIntensity, 0.0, 1.0);',
  },
  lava: {
    utils: noise,
    uniforms: 'uniform float uNoiseScale, uNoiseMix, uPhase, uIntensity;',
    body: `vec2 scroll = vec2(cos(uPhase), sin(uPhase));
    vec2 p = vUv * uNoiseScale;
    float sampleValue = mix(noise2(p + scroll), noise2(p * 2.1 - scroll), uNoiseMix);
    float value = smoothstep(0.2, 0.8, sampleValue * (0.6 + 0.4 * uIntensity));`,
  },
  hologram: {
    vary: vectors, utils: angle,
    uniforms: 'uniform float uIntensity, uPower, uScanFrequency, uPhase;',
    body: `float scan = 0.5 + 0.5 * sin(vPosition.y * uScanFrequency - uPhase);
    float rimLight = rim(uPower);
    float value = clamp((0.6 * rimLight + 0.4 * scan) * uIntensity, 0.0, 1.0);
    alpha *= 0.23 + 0.77 * value;`,
  },
};

export const shaderSources = Object.fromEntries(Object.entries(effects).map(([id, effect]) => [id, {
  vertexShader: vertex(effect.deform, effect.vary),
  fragmentShader: `
#define LAB_SHADER_${id} 1
varying vec2 vUv;
${effect.vary ?? ''}
uniform vec3 uColorA, uColorB;
uniform float uOpacity;
${effect.uniforms ?? ''}
${effect.utils ?? ''}
void main() {
  float alpha = uOpacity;
  ${effect.body}
  gl_FragColor = vec4(mix(uColorA, uColorB, value), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`.trim(),
}]));
