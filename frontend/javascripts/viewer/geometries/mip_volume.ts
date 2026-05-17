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
} from "three";

const VOLUME_SIZE = 32;

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

export class MipVolume {
  mesh: Mesh;

  constructor() {
    const data = createCrossData(VOLUME_SIZE);
    // @ts-ignore — Uint8Array<ArrayBufferLike> vs ArrayBufferView<ArrayBuffer> mismatch in TS 5.9 typings; works at runtime
    const texture = new Data3DTexture(data, VOLUME_SIZE, VOLUME_SIZE, VOLUME_SIZE);
    texture.format = RedFormat;
    texture.type = UnsignedByteType;
    texture.needsUpdate = true;

    const material = new ShaderMaterial({
      uniforms: {
        uVolume: { value: texture },
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
    // BoxGeometry is centered at origin; shift so it covers voxels [0, 32]^3
    this.mesh.position.set(VOLUME_SIZE / 2, VOLUME_SIZE / 2, VOLUME_SIZE / 2);
    // Keep the inverse world matrix uniform in sync each frame (avoids inverse() in GLSL)
    this.mesh.onBeforeRender = () => {
      material.uniforms.uInvModelMatrix.value.copy(this.mesh.matrixWorld).invert();
    };
  }

  dispose(): void {
    (this.mesh.material as ShaderMaterial).uniforms.uVolume.value.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
