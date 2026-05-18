import {
  BackSide,
  BoxGeometry,
  Data3DTexture,
  FloatType,
  GLSL3,
  Matrix4,
  Mesh,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3 as ThreeVector3,
} from "three";
import type { ElementClass } from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import { getLayerByName, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { scaleGlobalPositionWithMagnification } from "viewer/model/helpers/position_converter";
import { api, Store } from "viewer/singletons";
import type { DatasetLayerConfiguration } from "viewer/store";

const MOCK_SIZE = 32;
const MAX_VOXELS = 100 * 1024 * 1024;

type SupportedMipElementClass = "uint8" | "uint16" | "uint32" | "float";

type MipTextureConfig = {
  textureType: typeof UnsignedByteType | typeof FloatType;
  // Factor by which raw intensityRange values are divided to obtain the [0,1] (or float) range
  // that texture(uVolume, ...).r actually returns at runtime.
  normalizationFactor: number;
  createInitialBuffer: (n: number) => Uint8Array | Uint16Array | Float32Array;
};

function getMipTextureConfig(elementClass: SupportedMipElementClass): MipTextureConfig {
  switch (elementClass) {
    case "uint8":
      return { textureType: UnsignedByteType, normalizationFactor: 255, createInitialBuffer: (n) => new Uint8Array(n) };
    case "uint16":
      // WebGL2 has no GL_R16 (normalized 16-bit red) — only OpenGL core does.
      // Convert Uint16Array → Float32 at load time so we can use GL_R32F.
      return { textureType: FloatType, normalizationFactor: 65535, createInitialBuffer: (n) => new Float32Array(n) };
    case "uint32":
      // No normalized R32 format in WebGL2 — convert to float at load time
      return { textureType: FloatType, normalizationFactor: 4294967295, createInitialBuffer: (n) => new Float32Array(n) };
    case "float":
      // Raw float — no normalization; uMin/uMax uniforms stay in data units
      return { textureType: FloatType, normalizationFactor: 1, createInitialBuffer: (n) => new Float32Array(n) };
  }
}

function assertSupportedElementClass(elementClass: ElementClass): SupportedMipElementClass {
  if (elementClass === "uint8" || elementClass === "uint16" || elementClass === "uint32" || elementClass === "float") {
    return elementClass;
  }
  throw new Error(`MipVolume: unsupported element class "${elementClass}". Supported: uint8, uint16, uint32, float.`);
}

type MockedCrossSource = { type: "mocked cross" };
type DataSource = {
  type: "data";
  layerName: string;
  mag1Bbox: BoundingBoxMinMaxType;
  zoomStep?: number;
};
export type MipDatasource = MockedCrossSource | DataSource;

function createCrossData(size: number): Uint8Array {
  const data = new Uint8Array(new ArrayBuffer(size ** 3));
  const lo = size / 2 - 1;
  const hi = size / 2;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const onXBar = y >= lo && y <= hi && z >= lo && z <= hi;
        const onYBar = x >= lo && x <= hi && z >= lo && z <= hi;
        const onZBar = x >= lo && x <= hi && y >= lo && y <= hi;
        if (onXBar || onYBar || onZBar) {
          data[z * size * size + y * size + x] = 255;
        }
      }
    }
  }
  return data;
}

const VERTEX_SHADER = /* glsl */ `
uniform vec3 uVolumeSize;
out vec3 vLocalPos;

void main() {
  // BoxGeometry vertices are in [-size/2, size/2]; normalize to [-0.5, 0.5]
  vLocalPos = position / uVolumeSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform mat4 uInvModelMatrix;
uniform vec3 uVolumeSize;

uniform float uMin;
uniform float uMax;
uniform float uIsInverted;
uniform vec3 uLayerColor;
uniform float uAlpha;

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

void main() {
  if (uAlpha <= 0.0) discard;

  // Transform camera to normalized local space ([-0.5, 0.5]^3)
  vec3 localCam = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz / uVolumeSize;
  vec3 rd = normalize(vLocalPos - localCam);

  vec2 t = intersectAABB(localCam, rd);
  if (t.x > t.y) discard;

  float tStart = max(t.x, 0.0);
  float tEnd   = t.y;

  const int NUM_STEPS = 128;
  float stepSize = (tEnd - tStart) / float(NUM_STEPS);
  float maxVal = 0.0;

  for (int i = 0; i < NUM_STEPS; i++) {
    vec3 pos = localCam + (tStart + (float(i) + 0.5) * stepSize) * rd;
    // map [-0.5, 0.5] -> [0.0, 1.0] for texture lookup
    float val = texture(uVolume, pos + 0.5).r;
    maxVal = max(maxVal, val);
  }

  // Discard empty space when not inverted (inverted view: maxVal=0 → bright)
  if (maxVal < 0.001 && uIsInverted < 0.5) discard;

  // Apply intensity window: clamp then scale [uMin, uMax] → [0, 1]
  float scaled = clamp(maxVal, uMin, uMax);
  scaled = (uMax == uMin) ? 0.0 : (scaled - uMin) / (uMax - uMin);

  // Inversion: abs(val - isInverted). When isInverted=1.0 → 1-val, when 0.0 → val.
  scaled = abs(scaled - uIsInverted);

  vec3 color = scaled * uLayerColor;
  fragColor = vec4(color, uAlpha);
}
`;

function resolveDataSource(datasource: DataSource): {
  actualZoomStep: number;
  textureDims: [number, number, number];
  elementClass: SupportedMipElementClass;
} {
  const layer = getLayerByName(Store.getState().dataset, datasource.layerName);
  const magInfo = getMagInfo(layer.mags);
  const actualZoomStep = magInfo.getClosestExistingIndex(datasource.zoomStep ?? 0);
  const mag = magInfo.getMagByIndexOrThrow(actualZoomStep);
  const topLeft = scaleGlobalPositionWithMagnification(datasource.mag1Bbox.min, mag);
  const bottomRight = scaleGlobalPositionWithMagnification(datasource.mag1Bbox.max, mag, true);
  return {
    actualZoomStep,
    textureDims: [
      bottomRight[0] - topLeft[0],
      bottomRight[1] - topLeft[1],
      bottomRight[2] - topLeft[2],
    ],
    elementClass: assertSupportedElementClass(layer.elementClass),
  };
}

export class MipVolume {
  mesh: Mesh;
  private texture: Data3DTexture;
  private material: ShaderMaterial;
  private actualZoomStep: number | null = null;
  private unsubscribeFromStore: (() => void) | null = null;
  private normalizationFactor = 255; // updated per element class for "data" sources

  constructor(datasource: MipDatasource = { type: "mocked cross" }) {
    let texWidth: number;
    let texHeight: number;
    let texDepth: number;
    let initialData: Uint8Array | Uint16Array | Float32Array;
    let meshCenter: ThreeVector3;
    let volumeSize: ThreeVector3;
    let textureType: typeof UnsignedByteType | typeof FloatType = UnsignedByteType;

    if (datasource.type === "mocked cross") {
      initialData = createCrossData(MOCK_SIZE);
      texWidth = texHeight = texDepth = MOCK_SIZE;
      volumeSize = new ThreeVector3(MOCK_SIZE, MOCK_SIZE, MOCK_SIZE);
      meshCenter = new ThreeVector3(MOCK_SIZE / 2, MOCK_SIZE / 2, MOCK_SIZE / 2);
    } else {
      const { mag1Bbox } = datasource;
      const dx = mag1Bbox.max[0] - mag1Bbox.min[0];
      const dy = mag1Bbox.max[1] - mag1Bbox.min[1];
      const dz = mag1Bbox.max[2] - mag1Bbox.min[2];

      const { actualZoomStep, textureDims, elementClass } = resolveDataSource(datasource);
      const config = getMipTextureConfig(elementClass);
      textureType = config.textureType;
      this.normalizationFactor = config.normalizationFactor;

      const [tw, th, td] = textureDims;
      const totalVoxels = tw * th * td;
      if (totalVoxels > MAX_VOXELS) {
        throw new Error(
          `MipVolume: ${tw}×${th}×${td} = ${totalVoxels} voxels exceeds the ${MAX_VOXELS}-voxel limit`,
        );
      }

      this.actualZoomStep = actualZoomStep;
      initialData = config.createInitialBuffer(tw * th * td);
      texWidth = tw;
      texHeight = th;
      texDepth = td;
      volumeSize = new ThreeVector3(dx, dy, dz);
      meshCenter = new ThreeVector3(
        mag1Bbox.min[0] + dx / 2,
        mag1Bbox.min[1] + dy / 2,
        mag1Bbox.min[2] + dz / 2,
      );
    }

    // @ts-expect-error — Uint8Array<ArrayBufferLike> vs ArrayBufferView<ArrayBuffer> in TS 5.9
    this.texture = new Data3DTexture(initialData, texWidth, texHeight, texDepth);
    this.texture.format = RedFormat;
    this.texture.type = textureType;
    this.texture.needsUpdate = true;

    this.material = new ShaderMaterial({
      uniforms: {
        uVolume: { value: this.texture },
        uInvModelMatrix: { value: new Matrix4() },
        uVolumeSize: { value: volumeSize },
        // Intensity / display uniforms (defaults: full range, white, fully opaque)
        uMin: { value: 0.0 },
        uMax: { value: 1.0 },
        uIsInverted: { value: 0.0 },
        uLayerColor: { value: new ThreeVector3(1, 1, 1) },
        uAlpha: { value: 1.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      glslVersion: GLSL3,
      side: BackSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    const geometry = new BoxGeometry(volumeSize.x, volumeSize.y, volumeSize.z);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.copy(meshCenter);
    this.mesh.onBeforeRender = () => {
      this.material.uniforms.uInvModelMatrix.value.copy(this.mesh.matrixWorld).invert();
    };
  }

  // Updates display uniforms from layer configuration — mirrors updateUniformsForLayer
  // in plane_material_factory.ts. intensityRange values are in raw data units.
  updateLayerUniforms(settings: DatasetLayerConfiguration): void {
    const { alpha, intensityRange, isDisabled, isInverted, color } = settings;
    const [rawMin, rawMax] = intensityRange ?? [0, this.normalizationFactor];
    this.material.uniforms.uMin.value = rawMin / this.normalizationFactor;
    this.material.uniforms.uMax.value = rawMax / this.normalizationFactor;
    this.material.uniforms.uIsInverted.value = isInverted ? 1.0 : 0.0;
    if (color != null) {
      this.material.uniforms.uLayerColor.value.set(color[0] / 255, color[1] / 255, color[2] / 255);
    }
    this.material.uniforms.uAlpha.value = isDisabled ? 0 : alpha / 100;
  }

  // Subscribes to store changes for the given layer and keeps uniforms in sync.
  // Immediately applies the current settings on subscribe.
  subscribeToLayerSettings(layerName: string): void {
    this.unsubscribeFromStore?.();
    this.unsubscribeFromStore = listenToStoreProperty(
      (state) => state.datasetConfiguration.layers[layerName],
      (settings) => {
        if (settings != null) {
          this.updateLayerUniforms(settings);
        }
      },
      true,
    );
  }

  async loadData(datasource: DataSource): Promise<void> {
    const resolved = resolveDataSource(datasource);
    const actualZoomStep = this.actualZoomStep ?? resolved.actualZoomStep;
    const rawData = await api.data.getDataForBoundingBox(
      datasource.layerName,
      datasource.mag1Bbox,
      actualZoomStep,
    );

    let textureData: Uint8Array | Uint16Array | Float32Array;
    if (resolved.elementClass === "uint32") {
      // No normalized R32 format in WebGL2 — normalize to [0, 1] as float
      const src = rawData as Uint32Array;
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] / 4294967295;
      textureData = dst;
    } else if (resolved.elementClass === "uint16") {
      const src = rawData as Uint16Array;
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] / 65535;
      textureData = dst;
    } else if (resolved.elementClass === "float") {
      textureData = rawData as Float32Array;
    } else {
      textureData = new Uint8Array(rawData.buffer);
    }

    // @ts-expect-error — typed array variant not matching narrow ArrayBufferView in TS 5.9
    this.texture.image.data = textureData;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.unsubscribeFromStore?.();
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
