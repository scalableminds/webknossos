import {
  BackSide,
  BoxGeometry,
  Data3DTexture,
  GLSL3,
  Matrix4,
  Mesh,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3 as ThreeVector3,
} from "three";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import { api } from "viewer/singletons";

const VOLUME_SIZE = 32;

type MockedCrossSource = { type: "mocked cross" };
type DataSource = { type: "data"; layerName: string; mag1Bbox: BoundingBoxMinMaxType };
export type MipDatasource = MockedCrossSource | DataSource;

function createCrossData(size: number): Uint8Array {
  const data = new Uint8Array(new ArrayBuffer(size ** 3));
  const lo = size / 2 - 1; // 15
  const hi = size / 2; // 16
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
out vec3 vLocalPos;

void main() {
  // BoxGeometry(32,32,32) vertices range [-16, 16]; normalize to [-0.5, 0.5]
  vLocalPos = position / 32.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform mat4 uInvModelMatrix;

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
  // Transform camera position to local box space ([-0.5, 0.5]^3)
  vec3 localCam = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz / 32.0;
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

  if (maxVal < 0.001) discard;
  fragColor = vec4(vec3(maxVal), 1.0);
}
`;

function validateBboxSize(bbox: BoundingBoxMinMaxType): void {
  const [dx, dy, dz] = [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ];
  if (dx !== VOLUME_SIZE || dy !== VOLUME_SIZE || dz !== VOLUME_SIZE) {
    throw new Error(
      `MipVolume: bbox must be ${VOLUME_SIZE}³, got ${dx}×${dy}×${dz}`,
    );
  }
}

export class MipVolume {
  mesh: Mesh;
  private texture: Data3DTexture;

  constructor(datasource: MipDatasource = { type: "mocked cross" }) {
    let initialData: Uint8Array;
    let meshCenter: ThreeVector3;

    if (datasource.type === "mocked cross") {
      initialData = createCrossData(VOLUME_SIZE);
      meshCenter = new ThreeVector3(VOLUME_SIZE / 2, VOLUME_SIZE / 2, VOLUME_SIZE / 2);
    } else {
      validateBboxSize(datasource.mag1Bbox);
      initialData = new Uint8Array(new ArrayBuffer(VOLUME_SIZE ** 3));
      const { min } = datasource.mag1Bbox;
      meshCenter = new ThreeVector3(
        min[0] + VOLUME_SIZE / 2,
        min[1] + VOLUME_SIZE / 2,
        min[2] + VOLUME_SIZE / 2,
      );
    }

    // @ts-ignore — Uint8Array<ArrayBufferLike> vs ArrayBufferView<ArrayBuffer> mismatch in TS 5.9 typings; works at runtime
    this.texture = new Data3DTexture(initialData, VOLUME_SIZE, VOLUME_SIZE, VOLUME_SIZE);
    this.texture.format = RedFormat;
    this.texture.type = UnsignedByteType;
    this.texture.needsUpdate = true;

    const material = new ShaderMaterial({
      uniforms: {
        uVolume: { value: this.texture },
        uInvModelMatrix: { value: new Matrix4() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      glslVersion: GLSL3,
      side: BackSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    const geometry = new BoxGeometry(VOLUME_SIZE, VOLUME_SIZE, VOLUME_SIZE);
    this.mesh = new Mesh(geometry, material);
    this.mesh.position.copy(meshCenter);
    // Keep the inverse world matrix uniform in sync each frame (avoids inverse() in GLSL)
    this.mesh.onBeforeRender = () => {
      material.uniforms.uInvModelMatrix.value.copy(this.mesh.matrixWorld).invert();
    };
  }

  async loadData(datasource: DataSource): Promise<void> {
    const { layerName, mag1Bbox } = datasource;
    const rawData = await api.data.getDataForBoundingBox(layerName, mag1Bbox, 0);
    this.texture.image.data = new Uint8Array(rawData.buffer);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    (this.mesh.material as ShaderMaterial).uniforms.uVolume.value.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
