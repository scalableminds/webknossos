import _ from "lodash";
import { Matrix, solve } from "ml-matrix";
import type { Vector3 } from "oxalis/constants";
import { V3 } from "./mjs";

class TPS1d {
  // This class accepts 3-dimensional control points
  // with a 1-dimensional offset. Thus, this class needs
  // to be instantiated three times to get X, Y and Z offsets
  // for 3D coordinates.
  // See TPS3D for that.

  // The class is roughly inspired by
  // https://github.com/sarathknv/tps/blob/master/tps.py#L24
  a: number[] = []; // variables of the linear part of the TPS equation
  W: number[] = []; // variables of the non-linear part of the TPS equation
  cps: Vector3[] = []; // control point locations [(x1, y1), (x2, y2), ...]

  fit(offsetValues: number[], cps: Vector3[]) {
    this.cps = cps;
    const n = offsetValues.length;
    const v = Matrix.columnVector(offsetValues);

    const K = Matrix.zeros(cps.length, cps.length);
    for (let x = 0; x < cps.length; x++) {
      for (let y = 0; y < cps.length; y++) {
        let d = Math.sqrt(
          (cps[x][0] - cps[y][0]) ** 2 +
            (cps[x][1] - cps[y][1]) ** 2 +
            (cps[x][2] - cps[y][2]) ** 2,
        );

        if (d !== 0.0) {
          d = d ** 2.0 * Math.log(d ** 2.0);
        } else {
          d = 0;
        }

        K.set(x, y, d);
      }
    }

    // numpy:
    // P = np.hstack([np.ones((n, 1)), cps])
    const P = Matrix.zeros(n, 4);
    const ones = Matrix.ones(n, 1);
    P.setSubMatrix(ones, 0, 0);
    P.setSubMatrix(new Matrix(cps), 0, 1);

    // numpy:
    // L = np.vstack([np.hstack([K, P]), np.hstack([P.T, np.zeros((4, 4))])])
    const zeros = new Matrix(4, 4);
    const KP = new Matrix(K.rows, K.columns + P.columns);
    KP.setSubMatrix(K, 0, 0);
    KP.setSubMatrix(P, 0, K.columns);

    const PT = P.transpose();
    const PT_zeros = new Matrix(PT.rows, PT.columns + zeros.columns);
    PT_zeros.setSubMatrix(PT, 0, 0);
    PT_zeros.setSubMatrix(zeros, 0, PT.columns);

    const L = new Matrix(KP.rows + PT_zeros.rows, KP.columns);
    L.setSubMatrix(KP, 0, 0);
    L.setSubMatrix(PT_zeros, KP.rows, 0);

    // numpy:
    // Y = np.hstack([v, np.zeros((4,))])
    // Note that despite using horizontal-stack in NP, a vertical
    // stacking is happening, because column vectors are stacked.
    const Y = new Matrix(v.rows + 4, 1);
    Y.setSubMatrix(v, 0, 0);
    Y.setSubMatrix(Matrix.zeros(4, 1), v.rows, 0);

    const Wa = solve(L, Y);
    const Wa1D = Wa.to1DArray();

    this.W = Wa1D.slice(0, -4);
    this.a = Wa1D.slice(-4);
  }

  transform1D(x: number, y: number, z: number) {
    const linearPart = this.a[0] + x * this.a[1] + y * this.a[2] + z * this.a[3];

    // Calculate distance to each control point
    const dist: number[] = [];
    for (const cp of this.cps) {
      const d = ((x - cp[0]) ** 2 + (y - cp[1]) ** 2 + (z - cp[2]) ** 2) ** 0.5;
      dist.push(d);
    }

    let bendingPart = 0;
    for (const i of _.range(dist.length)) {
      let el = dist[i];
      if (el !== 0) {
        el = el ** 2 * Math.log(el ** 2);
      }
      bendingPart += el * this.W[i];
    }

    return linearPart + bendingPart;
  }

  _U(r: number) {
    if (r === 0.0) return 0;
    else return r ** 2 * Math.log(r ** 2);
  }
}

export default class TPS3D {
  tpsX = new TPS1d();
  tpsY = new TPS1d();
  tpsZ = new TPS1d();

  unscaledSourcePoints: Vector3[];
  unscaledTargetPoints: Vector3[];
  scale: Vector3;

  constructor(unscaledSourcePoints: Vector3[], unscaledTargetPoints: Vector3[], scale: Vector3) {
    const sourcePoints = unscaledSourcePoints.map((point) => V3.scale3(point, scale, [0, 0, 0]));
    const targetPoints = unscaledTargetPoints.map((point) => V3.scale3(point, scale, [0, 0, 0]));

    const [cps, offsetX, offsetY, offsetZ] = this.getControlPointsWithOffsets(
      sourcePoints,
      targetPoints,
    );

    this.unscaledSourcePoints = unscaledSourcePoints;
    this.unscaledTargetPoints = unscaledTargetPoints;
    this.scale = scale;

    this.tpsX.fit(offsetX, cps);
    this.tpsY.fit(offsetY, cps);
    this.tpsZ.fit(offsetZ, cps);
  }

  transform(x: number, y: number, z: number): Vector3 {
    const dx = this.tpsX.transform1D(x, y, z);
    const dy = this.tpsY.transform1D(x, y, z);
    const dz = this.tpsZ.transform1D(x, y, z);
    return [x + dx, y + dy, z + dz];
  }

  transformUnscaled(x: number, y: number, z: number): Vector3 {
    // Scale, transform and unscale input.
    const scaled = V3.scale3([x, y, z], this.scale, [0, 0, 0]);
    const scaledTransformed = this.transform(...scaled);
    const unscaledTransformed = V3.divide3(scaledTransformed, this.scale, [0, 0, 0]);
    return unscaledTransformed;
  }

  getControlPointsWithOffsets(
    sourcePoints: Vector3[],
    targetPoints: Vector3[],
    invert: boolean = false,
  ): [Vector3[], number[], number[], number[]] {
    if (invert) {
      const tmp = sourcePoints;
      sourcePoints = targetPoints;
      targetPoints = tmp;
    }

    const cps: Vector3[] = [];
    const offsetX: number[] = [];
    const offsetY: number[] = [];
    const offsetZ: number[] = [];
    for (const idx of _.range(0, sourcePoints.length)) {
      cps.push(sourcePoints[idx]);
      offsetX.push(targetPoints[idx][0] - sourcePoints[idx][0]);
      offsetY.push(targetPoints[idx][1] - sourcePoints[idx][1]);
      offsetZ.push(targetPoints[idx][2] - sourcePoints[idx][2]);
    }

    return [cps, offsetX, offsetY, offsetZ];
  }
}
