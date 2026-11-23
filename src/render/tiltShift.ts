import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Tilt-shift: a horizontal band of the screen stays sharp and blur ramps up
 * above and below it, which the eye reads as a macro photo of a miniature.
 * Implemented as two separable blur passes (horizontal then vertical) whose
 * radius depends on distance from the focus band; the vertical one also
 * grades (more saturation, a soft vignette) and writes the screen.
 */
export interface TiltShiftSettings {
  enabled: boolean;
  /** Vertical centre of the sharp band, 0 = bottom of screen, 1 = top. */
  focus: number;
  /** Half-height of the fully sharp band, in screen fractions. */
  band: number;
  /** Distance over which blur ramps from none to full. */
  falloff: number;
  /** Max blur radius in pixels (at 1080p; scales with resolution). */
  maxBlur: number;
  saturation: number;
  vignette: number;
}

export const DEFAULT_TILT_SHIFT: TiltShiftSettings = {
  enabled: true,
  focus: 0.48,
  band: 0.1,
  falloff: 0.32,
  maxBlur: 7,
  saturation: 1.25,
  vignette: 0.35,
};

/** The blur, shared by both passes: a 13-tap gaussian whose radius grows with distance from the sharp band. */
const BLUR = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 direction;
    uniform vec2 resolution;
    uniform float focus;
    uniform float band;
    uniform float falloff;
    uniform float maxBlur;
    varying vec2 vUv;

    vec4 tiltBlur() {
      float d = abs(vUv.y - focus);
      float amount = smoothstep(band, band + falloff, d);
      float radius = amount * maxBlur * (resolution.y / 1080.0);
      if (radius < 0.25) return texture2D(tDiffuse, vUv);
      // 13-tap gaussian, taps spread to cover the radius.
      vec2 stepUv = direction / resolution * (radius / 6.0);
      vec4 sum = vec4(0.0);
      float total = 0.0;
      for (int i = -6; i <= 6; i++) {
        float x = float(i);
        float w = exp(-x * x / 18.0);
        sum += texture2D(tDiffuse, vUv + stepUv * x) * w;
        total += w;
      }
      return sum / total;
    }
`;

const blurUniforms = () => ({
  tDiffuse: { value: null as THREE.Texture | null },
  direction: { value: new THREE.Vector2(1, 0) },
  resolution: { value: new THREE.Vector2(1, 1) },
  focus: { value: 0.5 },
  band: { value: 0.1 },
  falloff: { value: 0.3 },
  maxBlur: { value: 6 },
});

const vertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

/** The first, horizontal blur pass. */
const blurShader = {
  uniforms: blurUniforms(),
  vertexShader,
  fragmentShader: /* glsl */ `
    ${BLUR}
    void main() {
      gl_FragColor = tiltBlur();
    }
  `,
};

/**
 * The last pass, straight to the screen: the vertical blur, then the grade
 * (more saturation, a soft vignette), then the conversion to the screen's
 * colours that three's OutputPass would otherwise do in a pass of its own.
 * One full-screen pass instead of three. With tilt-shift off, maxBlur is 0
 * and the blur is a single read.
 */
const finalShader = {
  uniforms: { ...blurUniforms(), saturation: { value: 1.2 }, vignette: { value: 0.3 } },
  vertexShader,
  fragmentShader: /* glsl */ `
    ${BLUR}
    uniform float saturation;
    uniform float vignette;

    void main() {
      vec4 c = tiltBlur();
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(luma), c.rgb, saturation);
      vec2 p = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, length(p * vec2(1.2, 1.0)));
      gl_FragColor = c;
      #include <colorspace_fragment>
    }
  `,
};

export class TiltShift {
  readonly passes: ShaderPass[];
  private readonly horizontal = new ShaderPass(blurShader);
  /** Vertical blur, grade and output in one (see finalShader). */
  private readonly final = new ShaderPass(finalShader);

  constructor(readonly settings: TiltShiftSettings = { ...DEFAULT_TILT_SHIFT }) {
    this.final.uniforms.direction.value = new THREE.Vector2(0, 1);
    this.passes = [this.horizontal, this.final];
    this.apply();
  }

  setSize(width: number, height: number): void {
    for (const pass of this.passes) pass.uniforms.resolution.value.set(width, height);
  }

  /** Push settings into the shaders. Call after changing `settings`. */
  apply(): void {
    const s = this.settings;
    this.horizontal.enabled = s.enabled;
    for (const pass of this.passes) {
      pass.uniforms.focus.value = s.focus;
      pass.uniforms.band.value = s.band;
      pass.uniforms.falloff.value = s.falloff;
      // Off, the last pass still grades and outputs, without blurring.
      pass.uniforms.maxBlur.value = s.enabled ? s.maxBlur : 0;
    }
    this.final.uniforms.saturation.value = s.saturation;
    this.final.uniforms.vignette.value = s.vignette;
  }
}
