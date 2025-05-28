import type { Point3, Vector3 } from "viewer/constants";

// 51 matches
export type BoundingBoxMinMaxType = {
  min: Vector3;
  max: Vector3;
};

// 10 matches
export type ServerBoundingBox = {
  topLeft: Point3;
  width: number;
  height: number;
  depth: number;
};

// 39 matches
export type BoundingBoxObject = {
  readonly topLeft: Vector3;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
};
