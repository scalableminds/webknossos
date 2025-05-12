// See
//   https://github.com/imbcmdth/mjs/blob/master/index.js
// for all functions in M4x4, V2 and V3.
import _ from "lodash";
import type { Vector2, Vector3, Vector4 } from "viewer/constants";
import { chunk3 } from "viewer/model/helpers/chunk";

import mjs from "mjs";

const { M4x4: BareM4x4, V2: BareV2, V3: BareV3 } = mjs(Float32Array);

type Vector3Like = Vector3 | Float32Array;
type Vector2Like = Vector2 | Float32Array;

export type Vector16 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type Matrix4x4 = Vector16 | Float32Array;

const M4x4 = {
  ...BareM4x4,
  // Applies an affine transformation matrix on an array of points.
  transformPointsAffine(
    m: Matrix4x4,
    points: number[] | Float32Array,
    r?: Float32Array | Int32Array | null | undefined,
  ): Float32Array | Int32Array {
    if (r == null) {
      r = new Float32Array(points.length);
    }

    const m00 = m[0];
    const m01 = m[1];
    const m02 = m[2];
    const m10 = m[4];
    const m11 = m[5];
    const m12 = m[6];
    const m20 = m[8];
    const m21 = m[9];
    const m22 = m[10];
    const m30 = m[12];
    const m31 = m[13];
    const m32 = m[14];

    // DO NOT CHANGE to let compound assignment (+=) as V8 cannot optimize this
    for (let i = 0; i < points.length; i = i + 3) {
      const v0 = points[i];
      const v1 = points[i + 1];
      const v2 = points[i + 2];
      r[i] = m00 * v0 + m10 * v1 + m20 * v2 + m30;
      r[i + 1] = m01 * v0 + m11 * v1 + m21 * v2 + m31;
      r[i + 2] = m02 * v0 + m12 * v1 + m22 * v2 + m32;
    }

    return r;
  },

  // In contrast to transformPointsAffine, this function takes Array<Vector3>
  // and also returns Array<Vector3>
  transformVectorsAffine(m: Matrix4x4, _points: Vector3[]): Vector3[] {
    const points: Array<Array<number>> = _points as any as Array<Array<number>>;
    if (!Array.isArray(_points[0])) {
      throw new Error("transformVectorsAffine doesn't support typed arrays at the moment.");
    }
    // @ts-ignore
    return chunk3(M4x4.transformPointsAffine(m, _.flatten(points)));
  },
  // Applies a transformation matrix on an array of points.
  transformPoints(
    m: Matrix4x4,
    points: number[],
    r?: Float32Array | null | undefined,
  ): Float32Array {
    if (r == null) {
      r = new Float32Array(points.length);
    }

    for (let i = 0; i < points.length; i += 3) {
      const v0 = points[i];
      const v1 = points[i + 1];
      const v2 = points[i + 2];
      r[i] = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12];
      r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13];
      r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14];
      const w = m[3] * v0 + m[7] * v1 + m[11] * v2 + m[15];

      if (w !== 1.0) {
        r[0] /= w;
        r[1] /= w;
        r[2] /= w;
      }
    }

    return r;
  },

  inverse(mat: Matrix4x4, dest?: Matrix4x4): Matrix4x4 {
    if (dest == null) {
      dest = new Float32Array(16);
    }

    const a00 = mat[0];
    const a01 = mat[1];
    const a02 = mat[2];
    const a03 = mat[3];
    const a10 = mat[4];
    const a11 = mat[5];
    const a12 = mat[6];
    const a13 = mat[7];
    const a20 = mat[8];
    const a21 = mat[9];
    const a22 = mat[10];
    const a23 = mat[11];
    const a30 = mat[12];
    const a31 = mat[13];
    const a32 = mat[14];
    const a33 = mat[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    // calculate determinant
    const invDet = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    dest[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
    dest[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
    dest[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
    dest[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
    dest[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
    dest[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
    dest[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
    dest[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
    dest[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
    dest[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
    dest[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
    dest[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
    dest[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
    dest[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
    dest[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
    dest[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
    return dest;
  },

  transpose(m: Matrix4x4, r?: Matrix4x4): Matrix4x4 {
    if (m === r) {
      let tmp = 0.0;
      tmp = m[1];
      m[1] = m[4];
      m[4] = tmp;
      tmp = m[2];
      m[2] = m[8];
      m[8] = tmp;
      tmp = m[3];
      m[3] = m[12];
      m[12] = tmp;
      tmp = m[6];
      m[6] = m[9];
      m[9] = tmp;
      tmp = m[7];
      m[7] = m[13];
      m[13] = tmp;
      tmp = m[11];
      m[11] = m[14];
      m[14] = tmp;
      return m;
    }

    if (r == null) r = new Float32Array(16);

    r[0] = m[0];
    r[1] = m[4];
    r[2] = m[8];
    r[3] = m[12];
    r[4] = m[1];
    r[5] = m[5];
    r[6] = m[9];
    r[7] = m[13];
    r[8] = m[2];
    r[9] = m[6];
    r[10] = m[10];
    r[11] = m[14];
    r[12] = m[3];
    r[13] = m[7];
    r[14] = m[11];
    r[15] = m[15];

    return r;
  },

  extractTranslation(m: Matrix4x4, r?: Float32Array | null | undefined): Float32Array {
    if (r == null) {
      r = new Float32Array(3);
    }

    r[0] = m[12];
    r[1] = m[13];
    r[2] = m[14];
    return r;
  },

  identity(): Matrix4x4 {
    return BareM4x4.identity;
  },
};

const V2 = {
  ...BareV2,
  // Component-wise minimum of two vectors.
  min(vec1: Vector2, vec2: Vector2): Vector2 {
    return [Math.min(vec1[0], vec2[0]), Math.min(vec1[1], vec2[1])];
  },
  // Component-wise maximum of two vectors.
  max(vec1: Vector2, vec2: Vector2): Vector2 {
    return [Math.max(vec1[0], vec2[0]), Math.max(vec1[1], vec2[1])];
  },
  scale2(a: Vector2, k: Vector2, r?: Vector2Like): Vector2Like {
    if (r == null) r = new Float32Array(2);
    r[0] = a[0] * k[0];
    r[1] = a[1] * k[1];
    return r;
  },
  floor(vec: Vector2): Vector2 {
    return [Math.floor(vec[0]), Math.floor(vec[1])];
  },
  equals(vec1: Vector2, vec2: Vector2): boolean {
    return vec1[0] === vec2[0] && vec1[1] === vec2[1];
  },
  isEqual(a: Vector2, b: Vector2) {
    return a[0] === b[0] && a[1] === b[1];
  },
  clone(a: Vector2): Vector2 {
    return [a[0], a[1]];
  },
  prod(a: Vector2) {
    return a[0] * a[1];
  },
};

const _tmpVec: Vector3 = [0, 0, 0];

// @ts-ignore TS claims that the implementation doesn't match the overloading
function round(v: Vector3, r?: Vector3 | null | undefined): Vector3;
function round(v: Vector3Like, r?: Float32Array | null | undefined) {
  if (r == null) {
    r = new Float32Array(3);
  }

  r[0] = Math.round(v[0]);
  r[1] = Math.round(v[1]);
  r[2] = Math.round(v[2]);
  return r;
}

// @ts-ignore TS claims that the implementation doesn't match the overloading
function divide3(a: Vector3, k: Vector3, r?: Vector3): Vector3;
function divide3(a: Float32Array, k: Float32Array, r?: Float32Array) {
  if (r == null) r = new Float32Array(3);
  r[0] = a[0] / k[0];
  r[1] = a[1] / k[1];
  r[2] = a[2] / k[2];
  return r;
}

function scale3(a: Vector3, k: Vector3, r?: Vector3): Vector3;
function scale3(a: Vector3Like, k: Vector3Like, r?: Vector3Like): Vector3Like {
  if (r == null) r = new Float32Array(3);
  r[0] = a[0] * k[0];
  r[1] = a[1] * k[1];
  r[2] = a[2] * k[2];
  return r;
}

const V3 = {
  ...BareV3,
  // Component-wise minimum of two vectors.
  min(vec1: Vector3Like, vec2: Vector3Like): Vector3 {
    return [Math.min(vec1[0], vec2[0]), Math.min(vec1[1], vec2[1]), Math.min(vec1[2], vec2[2])];
  },

  // Component-wise maximum of two vectors.
  max(vec1: Vector3Like, vec2: Vector3Like): Vector3 {
    return [Math.max(vec1[0], vec2[0]), Math.max(vec1[1], vec2[1]), Math.max(vec1[2], vec2[2])];
  },

  equals(vec1: Vector3Like, vec2: Vector3Like): boolean {
    return vec1[0] === vec2[0] && vec1[1] === vec2[1] && vec1[2] === vec2[2];
  },

  round,

  floor(vec: ArrayLike<number>): Vector3 {
    return [Math.floor(vec[0]), Math.floor(vec[1]), Math.floor(vec[2])];
  },

  abs(vec: ArrayLike<number>): Vector3 {
    return [Math.abs(vec[0]), Math.abs(vec[1]), Math.abs(vec[2])];
  },

  trunc(vec: ArrayLike<number>): Vector3 {
    return [Math.trunc(vec[0]), Math.trunc(vec[1]), Math.trunc(vec[2])];
  },

  ceil(vec: ArrayLike<number>): Vector3 {
    return [Math.ceil(vec[0]), Math.ceil(vec[1]), Math.ceil(vec[2])];
  },

  toString(v: Array<number>): string {
    return v.join(", ");
  },

  scale3,

  divide3,

  fromMag1ToMag(vec: Vector3, targetMag: Vector3) {
    return V3.floor(V3.divide3(vec, targetMag));
  },

  fromMagToMag1(vec: Vector3, sourceMag: Vector3) {
    return V3.floor(V3.scale3(vec, sourceMag));
  },

  scaledSquaredDist(a: Vector3Like, b: Vector3Like, scale: Vector3) {
    // Computes the distance between two vectors while respecting a 3 dimensional scale
    // Use _tmpVec as result variable (third parameter) to avoid allocations
    V3.sub(a, b, _tmpVec);
    V3.scale3(_tmpVec, scale, _tmpVec);
    return V3.lengthSquared(_tmpVec);
  },

  scaledDist(a: Vector3Like, b: Vector3Like, scale: Vector3) {
    const squaredDist = V3.scaledSquaredDist(a, b, scale);
    return Math.sqrt(squaredDist);
  },

  toArray(vec: ArrayLike<number>): Vector3 {
    return [vec[0], vec[1], vec[2]];
  },

  roundElementToMag(vec: Vector3, magnification: Vector3, index: 0 | 1 | 2): Vector3 {
    // Rounds the element at the position referenced by index so that it's divisible by the
    // mag element.
    // For example: roundElementToMag([11, 12, 13], [4, 4, 2], 2) == [11, 12, 12]
    const res: Vector3 = [vec[0], vec[1], vec[2]];
    res[index] = Math.floor(res[index] / magnification[index]) * magnification[index];
    return res;
  },
  isEqual(a: Vector3, b: Vector3) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  },

  alignWithMag(a: Vector3, mag: Vector3, ceil: boolean = false) {
    const roundFn = ceil ? Math.ceil : Math.floor;
    return [
      roundFn(a[0] / mag[0]) * mag[0],
      roundFn(a[1] / mag[1]) * mag[1],
      roundFn(a[2] / mag[2]) * mag[2],
    ] as Vector3;
  },

  negate(a: Vector3) {
    return [-a[0], -a[1], -a[2]] as Vector3;
  },

  prod(a: Vector3) {
    return a[0] * a[1] * a[2];
  },
};

const V4 = {
  isEqual(a: Vector4, b: Vector4) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  },
};

export { M4x4, V2, V3, V4 };
