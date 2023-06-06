import _ from "lodash";
import { Matrix, solve } from "ml-matrix";
import { Vector3 } from "oxalis/constants";

function get_points_c555() {
  const source_points: Vector3[] = [];
  const target_points: Vector3[] = [];

  source_points.push([570.3021454931336, 404.5548993008739, 502.2248079151061]);
  target_points.push([568.1197424615385, 528.0132258461539, 1622.1119725846156]);
  source_points.push([590.14485196005, 420.83394119850186, 381.3802691885144]);
  target_points.push([742.3253686153846, 162.29058267692307, 3090.758328615385]);
  source_points.push([568.8462396254681, 435.02492976279655, 325.98584431960046]);
  target_points.push([824.791336, 379.83123384615385, 3824.023052]);
  source_points.push([466.424753133583, 536.3787606991261, 49.82532519350809]);
  target_points.push([1644.442906153846, 1510.902640923077, 7455.922066769231]);

  source_points.push([489.516219051186, 587.53670164794, 77.74560137328342]);
  target_points.push([2334.113423076923, 1358.3502144615384, 7127.546808923077]);
  source_points.push([542.191067465668, 386.53899285892635, 370.4734697627965]);
  target_points.push([202.37820938461536, 656.9199393846154, 3268.6702726153844]);
  source_points.push([606.9088153308364, 538.7038333583021, 391.91802244694134]);
  target_points.push([2219.641711692308, 251.88996276923075, 3052.8476364307694]);
  source_points.push([469.87355330836454, 503.27329345817725, 550.8630263920099]);
  target_points.push([1560.215556923077, 2038.833307076923, 1230.395686246154]);
  source_points.push([498.8105797503121, 498.7349532833958, 303.24820421972527]);
  target_points.push([1425.1619996923077, 1350.5069323076923, 4235.928434461539]);
  source_points.push([459.70790177278406, 531.0153151061173, 237.09300446941324]);
  target_points.push([1666.4806252307692, 1791.8833523076923, 5131.748126461538]);
  source_points.push([355.2574745817728, 483.12824349563044, 193.3370259675405]);
  target_points.push([793.6732470769231, 2907.752979384615, 5743.368062153846]);
  source_points.push([357.1785458426966, 463.1505866167291, 252.1267439450686]);
  target_points.push([611.5214206153846, 2921.7605673846156, 5020.635721538461]);
  source_points.push([444.25632963795255, 527.8174318102372, 80.38068576779017]);
  target_points.push([1510.590482153846, 1786.2746141538462, 7106.815691692307]);
  source_points.push([512.9217647191011, 551.4334625218477, 242.68991433208487]);
  target_points.push([2058.0610569230766, 1210.4094024615383, 5014.417560923077]);
  source_points.push([430.4984309862672, 455.0797327590512, 213.30023255930087]);
  target_points.push([664.7702375384615, 1959.340950153846, 5403.039626461538]);
  source_points.push([540.805116329588, 547.6317802746566, 372.9121447440699]);
  target_points.push([2158.228068, 1037.4212904615385, 3381.6276236923077]);
  source_points.push([501.69581895131086, 485.9274264419476, 412.72987543071156]);
  target_points.push([1341.3902910769232, 1441.7620196923076, 2872.038966215385]);
  source_points.push([591.9242968539326, 387.4151513358302, 596.0108966791511]);
  target_points.push([461.1800695384615, 343.9062129230769, 421.7303476615384]);
  source_points.push([584.156683770287, 504.2583560549313, 535.5067978027466]);
  target_points.push([1831.8590873846153, 634.0143027692308, 1278.193485876923]);
  source_points.push([504.58694082397005, 491.88490761548064, 617.1872392259675]);
  target_points.push([1548.3626932307693, 1679.6792150769231, 359.92012796923075]);
  source_points.push([542.1310808988763, 558.4876888139826, 636.364972434457]);
  target_points.push([2465.339630769231, 1401.4653535384614, 131.25040134153846]);
  source_points.push([515.8947048938826, 450.04399682896377, 635.6661106866417]);
  target_points.push([1075.063264, 1472.8561966153848, 72.02630727076924]);
  source_points.push([553.4819070411986, 372.3437979775281, 584.3894207990013]);
  target_points.push([191.3190251076923, 771.6955439999999, 602.0116679384615]);
  source_points.push([638.3767243445693, 514.9310932084894, 572.286986991261]);
  target_points.push([2116.0407298461537, 47.690367753846154, 768.9776767384616]);
  source_points.push([482.1100102621723, 492.8521135830212, 633.5717351310861]);
  target_points.push([1508.3328498461537, 1977.8310726153848, 185.3605911476923]);

  return [target_points, source_points];
}

class TPS3d {
  /*
  Note: Variable notaton is the same as that in the Principal Warps
  paper and https://profs.etsmtl.ca/hlombaert/thinplates/
  */
  a: number[] = []; // variables of the linear part of the TPS equation
  W: number[] = []; // variables of the non-linear part of the TPS equation
  cps: Vector3[] = []; // control point locations [(x1, y1), (x2, y2), ...]

  fit(vNumbers: number[], cps: Vector3[]) {
    /*Solves the TPS variables (W and a) for a given set of control points
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

        if (d != 0.0) {
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

  simple(x: number, y: number, z: number) {
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
      if (el != 0) {
        el = el ** 2 * Math.log(el ** 2);
      }
      bending_part += el * this.W[i];
    }

    return linear_part + bending_part;
  }

  _U(r: number) {
    if (r === 0.0) return 0;
    // todo:
    else return r ** 2 * Math.log(r ** 2);
  }
}

function getControlPointsWithDiff(
  invert: boolean = false,
): [Vector3[], number[], number[], number[]] {
  let [source_points, target_points] = get_points_c555();

  // _retval, affine, inliers = cv2.estimateAffine3D(
  //     target.reshape(1, -1, 3), source.reshape(1, -1, 3)
  // )
  // affine = np.vstack([affine, (0, 0, 0, 1)])

  // # source[:, 2] *= 100
  // # target[:, 2] *= 100

  if (invert) {
    console.log("source", source_points);
    console.log("target", target_points);

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

  return [cps, v_x, v_y, v_z]; //, affine
}

export const tps = () => {
  const [cps, v_x, v_y, v_z] = getControlPointsWithDiff(true);

  const tps_x = new TPS3d();
  const tps_y = new TPS3d();
  const tps_z = new TPS3d();

  tps_x.fit(v_x, cps);
  tps_y.fit(v_y, cps);
  tps_z.fit(v_z, cps);

  const transform = (x: number, y: number, z: number) => {
    const dx = tps_x.simple(x, y, z);
    const dy = tps_y.simple(x, y, z);
    const dz = tps_z.simple(x, y, z);
    return [x + dx, y + dy, z + dz];
  };

  console.log(transform(...cps[0]));
  console.log(transform(500, 501, 502));
};
