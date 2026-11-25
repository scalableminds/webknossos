import Toast from "libs/toast";
import {
  BackSide,
  BoxGeometry,
  Color,
  Data3DTexture,
  FloatType,
  GLSL3,
  Matrix4,
  Mesh,
  type Ray,
  RedFormat,
  ShaderMaterial,
  Vector3 as ThreeVector3,
  UnsignedByteType,
} from "three";
import type { APIDataset, ElementClass } from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import { getLayerByName, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { Store } from "viewer/singletons";
import type { DatasetLayerConfiguration, MipLayerConfig } from "viewer/store";

const MAX_LAYERS = 4;

export type SupportedMipElementClass = "uint8" | "uint16" | "uint32" | "float";

type MipTextureConfig = {
  textureType: typeof UnsignedByteType | typeof FloatType;
  // Factor by which raw intensityRange values are divided to obtain the [0,1] (or float) range
  // that texture(uVolume, ...).r actually returns at runtime.
  normalizationFactor: number;
};

function getMipTextureConfig(elementClass: SupportedMipElementClass): MipTextureConfig {
  switch (elementClass) {
    case "uint8":
      return { textureType: UnsignedByteType, normalizationFactor: 2 ** 8 - 1 };
    case "uint16":
      // WebGL2 has no GL_R16 (normalized 16-bit stored in a red channel) — only OpenGL core does.
      // Convert Uint16Array → Float32 at load time so we can use GL_R32F.
      return { textureType: FloatType, normalizationFactor: 2 ** 16 - 1 };
    case "uint32":
      // No normalized R32 format in WebGL2 — convert to float at load time
      return { textureType: FloatType, normalizationFactor: 2 ** 32 - 1 };
    case "float":
      // Raw float — no normalization; uMin/uMax uniforms stay in data units
      return { textureType: FloatType, normalizationFactor: 1 };
  }
}

export function assertSupportedElementClass(elementClass: ElementClass): SupportedMipElementClass {
  if (
    elementClass === "uint8" ||
    elementClass === "uint16" ||
    elementClass === "uint32" ||
    elementClass === "float"
  ) {
    return elementClass;
  }
  throw new Error(
    `MipVolume: unsupported element class "${elementClass}". Supported: uint8, uint16, uint32, float.`,
  );
}

function createPlaceholderTexture(): Data3DTexture {
  const tex = new Data3DTexture(new Uint8Array([0]), 1, 1, 1);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
}

// Resolves the actual zoom step, texture dimensions, and element class for a layer.
// Called by the MIP saga before downloading so it knows what to request.
export function resolveMipLayerSource(
  dataset: APIDataset,
  layerName: string,
  mag1Bbox: BoundingBoxMinMaxType,
  zoomStep: number,
): {
  actualZoomStep: number;
  textureDims: [number, number, number];
  elementClass: SupportedMipElementClass;
} {
  const layer = getLayerByName(dataset, layerName);
  const magInfo = getMagInfo(layer.mags);
  const actualZoomStep = magInfo.getClosestExistingIndex(zoomStep);
  const mag = magInfo.getMagByIndexOrThrow(actualZoomStep);
  const bboxInMag = new BoundingBox(mag1Bbox).fromMag1ToMag(mag);
  return {
    actualZoomStep,
    textureDims: bboxInMag.getSize(),
    elementClass: assertSupportedElementClass(layer.elementClass),
  };
}

const VERTEX_SHADER = `
uniform vec3 uVolumeSize;
out vec3 vLocalPos;

void main() {
  // BoxGeometry vertices are in [-size/2, size/2]; normalize to [-0.5, 0.5]
  vLocalPos = position / uVolumeSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER_COMMON_HEAD = `
precision highp float;
precision highp sampler3D;

const int MAX_LAYERS = ${MAX_LAYERS};

uniform sampler3D uVolumes[MAX_LAYERS];
uniform int uNumLayers;
uniform vec3 uLayerColors[MAX_LAYERS];
uniform float uLayerMins[MAX_LAYERS];
uniform float uLayerMaxs[MAX_LAYERS];
uniform float uLayerIsInverted[MAX_LAYERS];
uniform float uLayerGammas[MAX_LAYERS];
uniform float uLayerAlphas[MAX_LAYERS];
uniform mat4 uInvModelMatrix;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform vec3 uVolumeSize;
uniform int uNumSteps;
uniform vec3 uCameraForward;
uniform vec3 uCameraPosition;
uniform bool uIsPerspective;

in vec3 vLocalPos;
out vec4 fragColor;

vec2 intersectAABB(vec3 ro, vec3 rd) {
  vec3 t0 = (vec3(-0.5) - ro) / rd;
  vec3 t1 = (vec3( 0.5) - ro) / rd;
  vec3 tMin = min(t0, t1);
  vec3 tMax = max(t0, t1);
  float tNear = max(max(tMin.x, tMin.y), tMin.z);
  float tFar  = min(min(tMax.x, tMax.y), tMax.z);
  return vec2(tNear, tFar);
}

// GLSL ES 3.0 forbids indexing sampler arrays with non-constant expressions.
// Use an explicit if-ladder so each array access uses a literal index.
float sampleVolume(int j, vec3 uvw) {
  if (j == 0) return texture(uVolumes[0], uvw).r;
  if (j == 1) return texture(uVolumes[1], uvw).r;
  if (j == 2) return texture(uVolumes[2], uvw).r;
  return texture(uVolumes[3], uvw).r;
}

// Maps a raw sample to its displayed intensity in [0, 1], mirroring the XY plane shader:
// intensity window -> gamma correction -> inversion. Must be kept in sync with
// computeDisplayValue (CPU picking) below.
float displayValue(int j, float raw) {
  float layerMin = uLayerMins[j];
  float layerMax = uLayerMaxs[j];
  // The XY shader falls back to black when min == max (also for inverted layers).
  if (layerMax == layerMin) return 0.0;
  float scaled = (clamp(raw, layerMin, layerMax) - layerMin) / (layerMax - layerMin);
  scaled = pow(scaled, 1.0 / uLayerGammas[j]);
  return abs(scaled - uLayerIsInverted[j]);
}
`;

function buildFragmentShader(writeDepth: boolean): string {
  return (
    FRAGMENT_SHADER_COMMON_HEAD +
    `
void main() {
  if (uNumLayers == 0) discard;

  // All vectors are in normalized local space ([-0.5, 0.5]^3), matching the vertex
  // shader's normalization (vLocalPos = position / uVolumeSize).
  vec3 rd;
  // Parameter of the camera position along the ray (only relevant for perspective).
  float tCamera = -1e20;
  if (uIsPerspective) {
    // Perspective: each ray goes from the camera position through this fragment.
    vec3 localCam = (uInvModelMatrix * vec4(uCameraPosition, 1.0)).xyz / uVolumeSize;
    vec3 camToFrag = vLocalPos - localCam;
    rd = normalize(camToFrag);
    tCamera = -length(camToFrag);
  } else {
    // Orthographic: all rays share the same direction (camera forward).
    // w=0 for a direction vector (no translation).
    vec3 localDir = (uInvModelMatrix * vec4(uCameraForward, 0.0)).xyz;
    rd = normalize(localDir / uVolumeSize);
  }

  // Use the fragment's position on the back face as the reference point on the ray.
  // The slab test returns negative tNear (ray entered front face before vLocalPos)
  // and tFar ≈ 0 (we are at/near the back face).
  vec2 t = intersectAABB(vLocalPos, rd);
  if (t.x > t.y) discard;

  // Don't sample behind the camera if it is inside the volume.
  float tStart = max(t.x, tCamera);
  float tEnd   = t.y;
  float stepSize = (tEnd - tStart) / float(uNumSteps);

  // displayValue is monotonic in the raw value: non-decreasing for normal layers and
  // non-increasing for inverted ones. Therefore, the maximum displayed intensity along a ray
  // belongs to the maximum raw value (normal) or the minimum raw value (inverted). Track
  // max(sign * raw) with sign = -1 for inverted layers to avoid evaluating displayValue per sample.
  float projectionSigns[MAX_LAYERS];
  float extremeVals[MAX_LAYERS];
  for (int j = 0; j < MAX_LAYERS; j++) {
    projectionSigns[j] = 1.0 - 2.0 * uLayerIsInverted[j];
    extremeVals[j] = -1e30;
  }
  ${
    writeDepth
      ? `
  // Track the step with the highest combined weighted intensity for gl_FragDepth.
  float maxCombinedVal = 0.0;
  float bestT = tStart;
  `
      : ""
  }
  for (int i = 0; i < uNumSteps; i++) {
    float stepT = tStart + (float(i) + 0.5) * stepSize;
    vec3 pos = vLocalPos + stepT * rd;
    // map [-0.5, 0.5] -> [0.0, 1.0] for texture lookup
    vec3 uvw = pos + 0.5;
    ${
      writeDepth
        ? `
    float combined = 0.0;
    `
        : ""
    }
    for (int j = 0; j < uNumLayers; j++) {
      float val = sampleVolume(j, uvw);
      extremeVals[j] = max(extremeVals[j], projectionSigns[j] * val);
      ${writeDepth ? "combined += displayValue(j, val) * uLayerAlphas[j];" : ""}
    }
    ${
      writeDepth
        ? `
    if (combined > maxCombinedVal) { maxCombinedVal = combined; bestT = stepT; }
    `
        : ""
    }
  }

  // Apply intensity window, gamma, inversion and layer color; blend additively across layers.
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  for (int j = 0; j < uNumLayers; j++) {
    float value = displayValue(j, projectionSigns[j] * extremeVals[j]);
    color += uLayerColors[j] * value * uLayerAlphas[j];
    alpha = max(alpha, value * uLayerAlphas[j]);
  }

  if (alpha < 0.001) discard;
  // color is already weighted by intensity and alpha. Over a black background, it is blended
  // as premultiplied (see onBeforeRender), which yields exactly the additive color of the XY
  // viewports. Over a non-black background, straight-alpha blending is used instead so that
  // the projection darkens the background and stays visible (e.g. a white layer on white).
  fragColor = vec4(color, alpha);
  ${
    writeDepth
      ? `
  // Write the depth of the dominant voxel so meshes occlude/are occluded correctly.
  // vLocalPos + bestT * rd is in normalized [-0.5, 0.5] space; multiply by uVolumeSize
  // to get mesh-local coordinates for the modelViewMatrix transform.
  vec3 localBest = (vLocalPos + bestT * rd) * uVolumeSize;
  vec4 clipPos = uProjectionMatrix * uModelViewMatrix * vec4(localBest, 1.0);
  gl_FragDepth = (clipPos.z / clipPos.w + 1.0) * 0.5;
  `
      : ""
  }
}
`
  );
}

type LayerState = {
  layerName: string;
  texture: Data3DTexture;
  unsubscribe: () => void;
  normalizationFactor: number;
  // Cached display values for rebuild after layer removal
  displayMin: number;
  displayMax: number;
  isInverted: number;
  gamma: number;
  alpha: number;
  color: ThreeVector3;
};

// CPU counterpart of the GLSL displayValue function. Must be kept in sync.
function computeDisplayValue(layer: LayerState, raw: number): number {
  const { displayMin, displayMax } = layer;
  if (displayMax === displayMin) return 0;
  const clamped = Math.min(Math.max(raw, displayMin), displayMax);
  const scaled = ((clamped - displayMin) / (displayMax - displayMin)) ** (1 / layer.gamma);
  return Math.abs(scaled - layer.isInverted);
}

export class MipVolume {
  mesh: Mesh;
  private material: ShaderMaterial;
  private layers: LayerState[] = [];
  private placeholderTexture: Data3DTexture;
  private depthWriteEnabled = false;

  constructor(mag1Bbox: BoundingBoxMinMaxType) {
    this.placeholderTexture = createPlaceholderTexture();

    const { min, max } = mag1Bbox;
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const volumeSize = new ThreeVector3(dx, dy, dz);
    const meshCenter = new ThreeVector3(min[0] + dx / 2, min[1] + dy / 2, min[2] + dz / 2);

    const placeholders = Array.from({ length: MAX_LAYERS }, () => this.placeholderTexture);
    const defaultColors = Array.from({ length: MAX_LAYERS }, () => new ThreeVector3(1, 1, 1));
    const zeros = Array.from({ length: MAX_LAYERS }, () => 0);
    const ones = Array.from({ length: MAX_LAYERS }, () => 1);

    this.material = new ShaderMaterial({
      uniforms: {
        uVolumes: { value: placeholders },
        uNumLayers: { value: 0 },
        uLayerColors: { value: defaultColors },
        uLayerMins: { value: zeros.slice() },
        uLayerMaxs: { value: ones.slice() },
        uLayerIsInverted: { value: zeros.slice() },
        uLayerGammas: { value: ones.slice() },
        uLayerAlphas: { value: ones.slice() },
        uInvModelMatrix: { value: new Matrix4() },
        uModelViewMatrix: { value: new Matrix4() },
        uProjectionMatrix: { value: new Matrix4() },
        uVolumeSize: { value: volumeSize },
        uNumSteps: { value: 128 },
        uCameraForward: { value: new ThreeVector3(0, 0, -1) },
        uCameraPosition: { value: new ThreeVector3() },
        uIsPerspective: { value: false },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: buildFragmentShader(false),
      glslVersion: GLSL3,
      side: BackSide,
      transparent: true,
      // Toggled per render depending on the background color (see onBeforeRender).
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
    });

    const geometry = new BoxGeometry(dx, dy, dz);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.copy(meshCenter);
    const clearColor = new Color();
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      // Premultiplied (additive) blending only matches the XY viewports over a black background
      // (dark theme). Over a light background it would render a white layer as plain white,
      // making the projection invisible, so fall back to straight-alpha blending there.
      renderer.getClearColor(clearColor);
      this.material.premultipliedAlpha = clearColor.getHex() === 0x000000;
      this.material.uniforms.uInvModelMatrix.value.copy(this.mesh.matrixWorld).invert();
      // Store the world direction into uCameraForward
      camera.getWorldDirection(this.material.uniforms.uCameraForward.value);
      camera.getWorldPosition(this.material.uniforms.uCameraPosition.value);
      this.material.uniforms.uIsPerspective.value =
        (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
      this.material.uniforms.uModelViewMatrix.value.multiplyMatrices(
        camera.matrixWorldInverse,
        this.mesh.matrixWorld,
      );
      (this.material.uniforms.uProjectionMatrix.value as Matrix4).copy(
        (camera as { projectionMatrix: Matrix4 }).projectionMatrix,
      );
    };
  }

  // Updates display uniforms from layer configuration — mirrors updateUniformsForLayer
  // in plane_material_factory.ts. intensityRange values are in raw data units.
  private updateUniformsForLayer(layerName: string, settings: DatasetLayerConfiguration): void {
    const index = this.layers.findIndex((l) => l.layerName === layerName);
    if (index === -1) return;
    const layer = this.layers[index];
    const { alpha, intensityRange, isDisabled, isInverted, gammaCorrectionValue, color } = settings;
    const [rawMin, rawMax] = intensityRange ?? [0, layer.normalizationFactor];
    layer.displayMin = rawMin / layer.normalizationFactor;
    layer.displayMax = rawMax / layer.normalizationFactor;
    layer.isInverted = isInverted ? 1.0 : 0.0;
    layer.gamma = gammaCorrectionValue;
    layer.alpha = isDisabled ? 0 : alpha / 100;
    if (color != null) {
      layer.color.set(color[0] / 255, color[1] / 255, color[2] / 255);
    }
    (this.material.uniforms.uLayerMins.value as number[])[index] = layer.displayMin;
    (this.material.uniforms.uLayerMaxs.value as number[])[index] = layer.displayMax;
    (this.material.uniforms.uLayerIsInverted.value as number[])[index] = layer.isInverted;
    (this.material.uniforms.uLayerGammas.value as number[])[index] = layer.gamma;
    (this.material.uniforms.uLayerAlphas.value as number[])[index] = this.getEffectiveAlpha(layer);
    (this.material.uniforms.uLayerColors.value as ThreeVector3[])[index].copy(layer.color);
  }

  // A layer whose data has not been downloaded yet only has the 1x1x1 zero placeholder texture.
  // Hide it so that inverted layers don't render as a solid white box while loading.
  private getEffectiveAlpha(layer: LayerState): number {
    return layer.texture === this.placeholderTexture ? 0 : layer.alpha;
  }

  private rebuildUniforms(): void {
    const textures = this.material.uniforms.uVolumes.value as Data3DTexture[];
    const colors = this.material.uniforms.uLayerColors.value as ThreeVector3[];
    const mins = this.material.uniforms.uLayerMins.value as number[];
    const maxs = this.material.uniforms.uLayerMaxs.value as number[];
    const inverted = this.material.uniforms.uLayerIsInverted.value as number[];
    const gammas = this.material.uniforms.uLayerGammas.value as number[];
    const alphas = this.material.uniforms.uLayerAlphas.value as number[];

    for (let i = 0; i < MAX_LAYERS; i++) {
      if (i < this.layers.length) {
        const l = this.layers[i];
        textures[i] = l.texture;
        colors[i].copy(l.color);
        mins[i] = l.displayMin;
        maxs[i] = l.displayMax;
        inverted[i] = l.isInverted;
        gammas[i] = l.gamma;
        alphas[i] = this.getEffectiveAlpha(l);
      } else {
        textures[i] = this.placeholderTexture;
      }
    }
    this.material.uniforms.uNumLayers.value = this.layers.length;
  }

  setNumSteps(n: number): void {
    this.material.uniforms.uNumSteps.value = n;
  }

  setDepthWrite(enabled: boolean): void {
    if (enabled === this.depthWriteEnabled) return;
    this.depthWriteEnabled = enabled;
    // Swap to the appropriate shader variant; needsUpdate triggers recompilation.
    this.material.fragmentShader = buildFragmentShader(enabled);
    this.material.needsUpdate = true;
  }

  hasLayer(layerName: string): boolean {
    return this.layers.some((l) => l.layerName === layerName);
  }

  get layerCount(): number {
    return this.layers.length;
  }

  // Registers a new layer slot with a placeholder texture and subscribes to display settings.
  // The actual data must be supplied separately via setLayerData once downloaded.
  // Returns false (and shows a toast, without throwing) if the layer cannot be added — e.g.
  // because its element class is unsupported by MIP rendering — so callers can skip it
  // instead of crashing the store-subscription callback this runs in.
  addLayer(config: MipLayerConfig): boolean {
    if (this.layers.length >= MAX_LAYERS) {
      console.warn("MipVolume: max layers reached, ignoring addLayer for", config.layerName);
      return false;
    }
    if (this.hasLayer(config.layerName)) {
      return false;
    }

    let texConfig: MipTextureConfig;
    try {
      texConfig = getMipTextureConfig(
        assertSupportedElementClass(
          getLayerByName(Store.getState().dataset, config.layerName).elementClass,
        ),
      );
    } catch (error) {
      Toast.error(`MIP rendering does not support the data type of layer "${config.layerName}".`);
      console.error(error);
      return false;
    }

    const index = this.layers.length;
    const layerState: LayerState = {
      layerName: config.layerName,
      texture: this.placeholderTexture,
      normalizationFactor: texConfig.normalizationFactor,
      unsubscribe: () => {},
      displayMin: 0,
      displayMax: 1,
      isInverted: 0,
      gamma: 1,
      alpha: 1,
      color: new ThreeVector3(1, 1, 1),
    };
    this.layers.push(layerState);
    (this.material.uniforms.uVolumes.value as Data3DTexture[])[index] = this.placeholderTexture;
    this.material.uniforms.uNumLayers.value = this.layers.length;

    layerState.unsubscribe = listenToStoreProperty(
      (state) => state.datasetConfiguration.layers[config.layerName],
      (settings) => {
        if (settings != null) this.updateUniformsForLayer(config.layerName, settings);
      },
      true,
    );
    return true;
  }

  // Called by the MIP saga once the raw voxel data has been downloaded.
  // Converts the typed array to a Data3DTexture and uploads it to the GPU.
  setLayerData(
    layerName: string,
    rawData: Uint8Array | Uint16Array | Uint32Array | Float32Array,
    dims: [number, number, number],
    elementClass: SupportedMipElementClass,
  ): void {
    const index = this.layers.findIndex((l) => l.layerName === layerName);
    if (index === -1) return; // layer was removed while loading
    const layerState = this.layers[index];
    const texConfig = getMipTextureConfig(elementClass);
    const [width, height, depth] = dims;

    let textureData: Uint8Array | Float32Array;
    if (elementClass === "uint32") {
      // No normalized R32 format in WebGL2 — normalize to [0, 1] as float
      const src = rawData as Uint32Array;
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] / texConfig.normalizationFactor;
      textureData = dst;
    } else if (elementClass === "uint16") {
      const src = rawData as Uint16Array;
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] / texConfig.normalizationFactor;
      textureData = dst;
    } else if (elementClass === "float") {
      textureData = rawData as Float32Array;
    } else {
      textureData = rawData as Uint8Array;
    }

    // @ts-expect-error — Uint8Array<ArrayBufferLike> vs ArrayBufferView<ArrayBuffer> in TS 5.9
    const realTexture = new Data3DTexture(textureData, width, height, depth);
    realTexture.format = RedFormat;
    realTexture.type = texConfig.textureType;
    realTexture.needsUpdate = true;

    if (layerState.texture !== this.placeholderTexture) {
      layerState.texture.dispose();
    }
    layerState.texture = realTexture;
    (this.material.uniforms.uVolumes.value as Data3DTexture[])[index] = realTexture;
    (this.material.uniforms.uLayerAlphas.value as number[])[index] =
      this.getEffectiveAlpha(layerState);
  }

  removeLayer(layerName: string): void {
    const index = this.layers.findIndex((l) => l.layerName === layerName);
    if (index === -1) return;
    const layer = this.layers[index];
    layer.unsubscribe();
    if (layer.texture !== this.placeholderTexture) {
      layer.texture.dispose();
    }
    this.layers.splice(index, 1);
    this.rebuildUniforms();
  }

  // CPU ray march matching the GLSL fragment shader logic.
  // Returns the world-space position of the voxel with the highest combined displayed intensity
  // (the same criterion the shader uses for gl_FragDepth), or null.
  findMaxIntensityPosition(ray: Ray): ThreeVector3 | null {
    if (this.layers.length === 0) return null;

    const vs = this.material.uniforms.uVolumeSize.value as ThreeVector3;
    const numSteps = this.material.uniforms.uNumSteps.value as number;

    // Match shader: normPos = (invModelMatrix * worldPos) / uVolumeSize
    const invMatrix = new Matrix4().copy(this.mesh.matrixWorld).invert();
    const localOrigin = ray.origin.clone().applyMatrix4(invMatrix);
    // Transform a point on the ray to local space to get direction (handles non-uniform scale)
    const localPoint = ray.origin.clone().add(ray.direction).applyMatrix4(invMatrix);
    const localDir = localPoint.sub(localOrigin);

    const normOrigin = new ThreeVector3(
      localOrigin.x / vs.x,
      localOrigin.y / vs.y,
      localOrigin.z / vs.z,
    );
    const normDir = new ThreeVector3(
      localDir.x / vs.x,
      localDir.y / vs.y,
      localDir.z / vs.z,
    ).normalize();

    // AABB slab test — identical to shader's intersectAABB; IEEE 754 handles ±Inf correctly
    const t0x = (-0.5 - normOrigin.x) / normDir.x;
    const t1x = (0.5 - normOrigin.x) / normDir.x;
    const t0y = (-0.5 - normOrigin.y) / normDir.y;
    const t1y = (0.5 - normOrigin.y) / normDir.y;
    const t0z = (-0.5 - normOrigin.z) / normDir.z;
    const t1z = (0.5 - normOrigin.z) / normDir.z;
    const tNear = Math.max(Math.min(t0x, t1x), Math.min(t0y, t1y), Math.min(t0z, t1z));
    const tFar = Math.min(Math.max(t0x, t1x), Math.max(t0y, t1y), Math.max(t0z, t1z));
    if (tNear > tFar) return null;

    const tStart = Math.max(tNear, 0);
    const stepSize = (tFar - tStart) / numSteps;
    let maxVal = 0;
    let maxT = tStart;

    // Gather texture images of all loaded and visible layers
    const sources = this.layers
      .filter((l) => this.getEffectiveAlpha(l) > 0)
      .map((layer) => {
        const image = layer.texture.image as {
          data: ArrayLike<number> | null;
          width: number;
          height: number;
          depth: number;
        };
        // UnsignedByteType textures are sampled as normalized [0, 1] values on the GPU,
        // but their CPU-side data still holds raw bytes.
        const sampleScale = layer.texture.type === UnsignedByteType ? 1 / 255 : 1;
        return { layer, image, sampleScale };
      });

    for (let i = 0; i < numSteps; i++) {
      const t = tStart + (i + 0.5) * stepSize;
      const p = normOrigin.clone().addScaledVector(normDir, t);
      let combined = 0;
      for (const { layer, image, sampleScale } of sources) {
        const { data, width, height, depth } = image;
        if (data == null || width === 0) continue;
        const xi = Math.max(0, Math.min(Math.floor((p.x + 0.5) * width), width - 1));
        const yi = Math.max(0, Math.min(Math.floor((p.y + 0.5) * height), height - 1));
        const zi = Math.max(0, Math.min(Math.floor((p.z + 0.5) * depth), depth - 1));
        const raw = data[xi + yi * width + zi * width * height] * sampleScale;
        combined += computeDisplayValue(layer, raw) * layer.alpha;
      }
      if (combined > maxVal) {
        maxVal = combined;
        maxT = t;
      }
    }

    if (maxVal <= 0) return null;

    const normMax = normOrigin.clone().addScaledVector(normDir, maxT);
    const localMax = new ThreeVector3(normMax.x * vs.x, normMax.y * vs.y, normMax.z * vs.z);
    return localMax.applyMatrix4(this.mesh.matrixWorld);
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.unsubscribe();
      if (layer.texture !== this.placeholderTexture) {
        layer.texture.dispose();
      }
    }
    this.layers = [];
    this.placeholderTexture.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
