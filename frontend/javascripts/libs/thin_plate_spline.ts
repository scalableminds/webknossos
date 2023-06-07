import _ from "lodash";
import { Matrix, solve } from "ml-matrix";
import { Vector3 } from "oxalis/constants";

class TPS1d {
  // This class accepts 3-dimensional control points
  // with a 1-dimensional offset. Thus, this class needs
  // to be instantiated three times to get X, Y and Z offsets
  // for 3D coordinates.
  // See TPS3D for that.

  /*
  Note: Variable notaton is the same as that in the Principal Warps
  paper and https://profs.etsmtl.ca/hlombaert/thinplates/
  */
  a: number[] = []; // variables of the linear part of the TPS equation
  W: number[] = []; // variables of the non-linear part of the TPS equation
  cps: Vector3[] = []; // control point locations [(x1, y1), (x2, y2), ...]

  fit(vNumbers: number[], cps: Vector3[]) {
    /*
    Solves the TPS variables (W and a) for a given set of control points
    cps: control point locations of the form [(x1, y1), (x2, y2), ...]
    v: height at the control points [v1, v2, ...]

    Solves the equation and updates the self.a and self.W variables

    Code is borrowed from https://github.com/mdedonno1337/TPS/blob/master/TPS/TPSpy/__init__.py
    */

    this.cps = cps;
    const n = vNumbers.length;
    const v = Matrix.columnVector(vNumbers);

    const K = Matrix.zeros(cps.length, cps.length);
    for (let x = 0; x < cps.length; x++) {
      for (let y = 0; y < cps.length; y++) {
        let d = Math.sqrt(
          (cps[x][0] - cps[y][0]) ** 2 +
            (cps[x][1] - cps[y][1]) ** 2 +
            (cps[x][2] - cps[y][2]) ** 2,
        );

        if (d !== 0.0) {
          d = (d ** 2.0 * Math.log2(d ** 2.0)) / Math.log2(2.718281828459045);
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
    const linear_part = this.a[0] + x * this.a[1] + y * this.a[2] + z * this.a[3];

    // Calculate distance to each control point
    const dist: number[] = [];
    for (const cp of this.cps) {
      const d = ((x - cp[0]) ** 2 + (y - cp[1]) ** 2 + (z - cp[2]) ** 2) ** 0.5;
      dist.push(d);
    }

    let bending_part = 0;
    for (const i of _.range(dist.length)) {
      let el = dist[i];
      if (el !== 0) {
        el = el ** 2 * Math.log(el ** 2);
      }
      bending_part += el * this.W[i];
    }

    return linear_part + bending_part;
  }

  _U(r: number) {
    if (r === 0.0) return 0;
    else return r ** 2 * Math.log(r ** 2);
  }
}

export default class TPS3D {
  tps_x = new TPS1d();
  tps_y = new TPS1d();
  tps_z = new TPS1d();

  constructor(source_points: Vector3[], target_points: Vector3[]) {
    const [cps, v_x, v_y, v_z] = this.getControlPointsWithDiff(source_points, target_points, true);

    this.tps_x.fit(v_x, cps);
    this.tps_y.fit(v_y, cps);
    this.tps_z.fit(v_z, cps);
  }

  transform(x: number, y: number, z: number): Vector3 {
    const dx = this.tps_x.transform1D(x, y, z);
    const dy = this.tps_y.transform1D(x, y, z);
    const dz = this.tps_z.transform1D(x, y, z);
    return [x + dx, y + dy, z + dz];
  }

  getControlPointsWithDiff(
    source_points: Vector3[],
    target_points: Vector3[],
    invert: boolean = false,
  ): [Vector3[], number[], number[], number[]] {
    if (invert) {
      let tmp = source_points;
      source_points = target_points;
      target_points = tmp;
    }

    const cps: Vector3[] = [];
    const v_x: number[] = [];
    const v_y: number[] = [];
    const v_z: number[] = [];
    for (const idx of _.range(0, source_points.length)) {
      cps.push(source_points[idx]);
      v_x.push(target_points[idx][0] - source_points[idx][0]);
      v_y.push(target_points[idx][1] - source_points[idx][1]);
      v_z.push(target_points[idx][2] - source_points[idx][2]);
    }

    return [cps, v_x, v_y, v_z];
  }
}
