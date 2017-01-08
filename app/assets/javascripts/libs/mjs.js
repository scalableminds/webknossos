const { M4x4, V2, V3 } = require("mjs")(Float32Array);

// Applies an affine transformation matrix on an array of points.
M4x4.transformPointsAffine = function (m, points, r) {
  if (r == null) { r = new Float32Array(points.length); }
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

  for (let i = 0; i < points.length; i += 3) {
    const v0 = points[i];
    const v1 = points[i + 1];
    const v2 = points[i + 2];

    r[i] = (m00 * v0) + (m10 * v1) + (m20 * v2) + m30;
    r[i + 1] = (m01 * v0) + (m11 * v1) + (m21 * v2) + m31;
    r[i + 2] = (m02 * v0) + (m12 * v1) + (m22 * v2) + m32;
  }

  return r;
};


// Applies a transformation matrix on an array of points.
M4x4.transformPoints = function (m, points, r) {
  if (r == null) { r = new Float32Array(points.length); }
  for (let i = 0; i < points.length; i += 3) {
    const v0 = points[i];
    const v1 = points[i + 1];
    const v2 = points[i + 2];

    r[i] = (m[0] * v0) + (m[4] * v1) + (m[8] * v2) + m[12];
    r[i + 1] = (m[1] * v0) + (m[5] * v1) + (m[9] * v2) + m[13];
    r[i + 2] = (m[2] * v0) + (m[6] * v1) + (m[10] * v2) + m[14];
    const w = (m[3] * v0) + (m[7] * v1) + (m[11] * v2) + m[15];

    if (w !== 1.0) {
      r[0] /= w;
      r[1] /= w;
      r[2] /= w;
    }
  }

  return r;
};


M4x4.inverse = function (mat, dest) {
  // cache matrix values
  if (dest == null) { dest = new Float32Array(16); }
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
  const b00 = (a00 * a11) - (a01 * a10);
  const b01 = (a00 * a12) - (a02 * a10);
  const b02 = (a00 * a13) - (a03 * a10);
  const b03 = (a01 * a12) - (a02 * a11);
  const b04 = (a01 * a13) - (a03 * a11);
  const b05 = (a02 * a13) - (a03 * a12);
  const b06 = (a20 * a31) - (a21 * a30);
  const b07 = (a20 * a32) - (a22 * a30);
  const b08 = (a20 * a33) - (a23 * a30);
  const b09 = (a21 * a32) - (a22 * a31);
  const b10 = (a21 * a33) - (a23 * a31);
  const b11 = (a22 * a33) - (a23 * a32);

  // calculate determinant
  const invDet = 1 / (((((b00 * b11) - (b01 * b10)) + (b02 * b09) + (b03 * b08)) - (b04 * b07)) + (b05 * b06));

  dest = [];
  dest[0] = (((a11 * b11) - (a12 * b10)) + (a13 * b09)) * invDet;
  dest[1] = (((-a01 * b11) + (a02 * b10)) - (a03 * b09)) * invDet;
  dest[2] = (((a31 * b05) - (a32 * b04)) + (a33 * b03)) * invDet;
  dest[3] = (((-a21 * b05) + (a22 * b04)) - (a23 * b03)) * invDet;
  dest[4] = (((-a10 * b11) + (a12 * b08)) - (a13 * b07)) * invDet;
  dest[5] = (((a00 * b11) - (a02 * b08)) + (a03 * b07)) * invDet;
  dest[6] = (((-a30 * b05) + (a32 * b02)) - (a33 * b01)) * invDet;
  dest[7] = (((a20 * b05) - (a22 * b02)) + (a23 * b01)) * invDet;
  dest[8] = (((a10 * b10) - (a11 * b08)) + (a13 * b06)) * invDet;
  dest[9] = (((-a00 * b10) + (a01 * b08)) - (a03 * b06)) * invDet;
  dest[10] = (((a30 * b04) - (a31 * b02)) + (a33 * b00)) * invDet;
  dest[11] = (((-a20 * b04) + (a21 * b02)) - (a23 * b00)) * invDet;
  dest[12] = (((-a10 * b09) + (a11 * b07)) - (a12 * b06)) * invDet;
  dest[13] = (((a00 * b09) - (a01 * b07)) + (a02 * b06)) * invDet;
  dest[14] = (((-a30 * b03) + (a31 * b01)) - (a32 * b00)) * invDet;
  dest[15] = (((a20 * b03) - (a21 * b01)) + (a22 * b00)) * invDet;

  return dest;
};


M4x4.extractTranslation = function (m, r) {
  if (r == null) { r = new Float32Array(3); }
  r[0] = m[12];
  r[1] = m[13];
  r[2] = m[14];
  return r;
};


V3.round = function (v, r) {
  if (r == null) { r = new Float32Array(3); }
  r[0] = Math.round(v[0]);
  r[1] = Math.round(v[1]);
  r[2] = Math.round(v[2]);
  return r;
};


V3.floor = v => v.map(number => Math.floor(number));


V3.toString = v => v.join(", ");

export { M4x4, V2, V3 };
