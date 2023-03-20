declare module "mjs" {
  type Vector3 = [number, number, number];
  type Vector3Like = Vector3 | Float32Array;
  type Vector2Like = Vector2 | Float32Array;

  export type Matrix4x4 =
    | [
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
      ]
    | Float32Array;

  export default (f: Float32ArrayConstructor) => ({
    M4x4: {
      identity: Matrix4x4,
      translate: function (
        m: Vector3,
        points: Matrix4x4,
        r?: Float32Array | number[] | null | undefined,
      ): Matrix4x4 {},
      scale: function (
        s: Vector3,
        m: Matrix4x4,
        r?: Float32Array | number[] | null | undefined,
      ): Matrix4x4 {},
      scale1: function (s: number, m: Matrix4x4, r?: Float32Array | null | undefined): Matrix4x4 {},
      mul: function (a: Matrix4x4, b: Matrix4x4, r?: Matrix4x4 | null | undefined): Matrix4x4 {},
      rotate: function (
        angle: number,
        axis: Vector3,
        m: Matrix4x4,
        r?: Float32Array | number[] | null | undefined,
      ): Matrix4x4 {},
      clone: function (m: Matrix4x4): Matrix4x4 {},
      transformLineAffine: function (m: Matrix4x4, v1: Vector3, v2: Vector3): Matrix4x4 {},
    },
    V2: {
      add: function (x: Vector2, y: Vector2, res?: Vector2): Vector2 {},
      sub: function (x: Vector2, y: Vector2, res?: Vector2): Vector2 {},
      scale: function (x: Vector2, f: number, res?: Vector2): Vector2 {},
      length: function (x: Vector2): number {},
    },
    V3: {
      add: function (x: Vector3, y: Vector3, res?: Vector3): Vector3 {},
      sub: function (x: Vector3Like, y: Vector3Like, res?: Vector3Like): Vector3 {},
      cross: function (x: Vector3, y: Vector3, res?: Vector3): Vector3 {},
      length: function (x: Vector3): number {},
      lengthSquared: function (x: Vector3): number {},
      scale: function (x: Vector3, f: number, res?: Vector2): Vector3 {},
      normalize: function (x: Vector3): Vector3 {},
      mul4x4: function (m: Matrix4x4, vec: Vector3, res?: Vector3): Vector3 {},
    },
  });
}
