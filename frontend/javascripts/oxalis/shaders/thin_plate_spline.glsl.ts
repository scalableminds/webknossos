import type TPS3D from "libs/thin_plate_spline";
import { formatNumberAsGLSLFloat } from "./utils.glsl";

export function generateTpsInitialization(
  tpsTransformPerLayer: Record<string, TPS3D>,
  name: string,
) {
  const tps = tpsTransformPerLayer[name];
  const ff = formatNumberAsGLSLFloat;

  const weightLines = [];
  for (let idx = 0; idx < tps.tpsX.cps.length; idx++) {
    weightLines.push(
      `          TPS_W_${name}[${idx}] = vec3(${ff(tps.tpsX.W[idx])}, ${ff(tps.tpsY.W[idx])}, ${ff(
        tps.tpsZ.W[idx],
      )});`,
    );
  }

  const cpsLines = [];
  for (let idx = 0; idx < tps.tpsX.cps.length; idx++) {
    const coords = tps.tpsX.cps[idx].map((num) => ff(num)).join(", ");
    cpsLines.push(`          TPS_cps_${name}[${idx}] = vec3(${coords});`);
  }

  const aLines = [];
  for (let idx = 0; idx < 4; idx++) {
    aLines.push(
      `          TPS_a_${name}[${idx}] = vec3(${ff(tps.tpsX.a[idx])}, ${ff(tps.tpsY.a[idx])}, ${ff(
        tps.tpsZ.a[idx],
      )});`,
    );
  }

  const code = `
const int TPS_CPS_LENGTH_${name} = ${tps.tpsX.cps.length};
vec3 TPS_W_${name}[TPS_CPS_LENGTH_${name}];
vec3 TPS_a_${name}[4];
vec3 TPS_cps_${name}[TPS_CPS_LENGTH_${name}];

void initializeTPSArraysFor${name}() {
${weightLines.join("\n")}
${cpsLines.join("\n")}
${aLines.join("\n")}
}
`;
  return code;
}

export function generateCalculateTpsOffsetFunction(name: string) {
  return `
    vec3 calculateTpsOffsetFor${name}(vec3 originalWorldCoord) {
      float x = originalWorldCoord.x * voxelSizeFactor.x;
      float y = originalWorldCoord.y * voxelSizeFactor.y;
      float z = originalWorldCoord.z * voxelSizeFactor.z;

      vec3 a[4] = TPS_a_${name};
      vec3 linear_part = a[0] + x * a[1] + y * a[2] + z * a[3];
      vec3 bending_part = vec3(0.0);

      for (int cpIdx = 0; cpIdx < TPS_CPS_LENGTH_${name}; cpIdx++) {
        // Calculate distance to each control point
        float dist = sqrt(
          pow(x - TPS_cps_${name}[cpIdx].x, 2.0) +
          pow(y - TPS_cps_${name}[cpIdx].y, 2.0) +
          pow(z - TPS_cps_${name}[cpIdx].z, 2.0)
        );

        if (dist != 0.0) {
          dist = pow(dist, 2.0) * log(pow(dist, 2.0));
        } else {
          dist = 0.;
        }
        bending_part += dist * TPS_W_${name}[cpIdx];
      }

      vec3 offset = (linear_part + bending_part) /  voxelSizeFactor;
      return offset;
    }
  `;
}
