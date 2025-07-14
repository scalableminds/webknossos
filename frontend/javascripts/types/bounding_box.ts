import type { Point3, Vector3 } from "viewer/constants";

export type BoundingBoxMinMaxType = {
  min: Vector3;
  max: Vector3;
};

export type BoundingBoxObject = {
  readonly topLeft: Vector3;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
};

export type BoundingBoxProto = {
  topLeft: Point3;
  width: number;
  height: number;
  depth: number;
};
