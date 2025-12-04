// This file is only for documentation:
// Types which were used for creating the datasource.schema.js
// The `flow2schema` node module has been used for conversion.

import type { VoxelSize } from "types/api_types";

// Please note that some manual changes to the schema are required.
type Vector2 = [number, number];
type Vector3 = [number, number, number];

type BoundingBox = {
  topLeft: Vector3;
  width: number;
  height: number;
  depth: number;
};
type DataLayerWKWPartial = BaseRemoteLayer & {
  dataFormat: "wkw";
};

type AxisKey = "x" | "y" | "z" | "c";
type BaseRemoteLayer = {
  boundingBox: BoundingBox;
  numChannels: number;
  mags: Array<{
    mag: Vector3;
    path: string;
    axisOrder: Record<AxisKey, number>;
  }>;
  additionalCoordinates?: Array<{
    name: string;
    index: number;
    bounds: Vector2;
  }>;
};
type DataLayerZarrPartial = BaseRemoteLayer & {
  dataFormat: "zarr";
};
type DataLayerN5Partial = BaseRemoteLayer & {
  dataFormat: "n5";
};
type DataLayerPrecomputedPartial = BaseRemoteLayer & {
  dataFormat: "neuroglancerPrecomputed";
};
type DataLayerZarr3Partial = BaseRemoteLayer & {
  dataFormat: "zarr3";
};
export type DataLayer = {
  name: string;
  category: "color" | "segmentation";
  elementClass:
    | "uint8"
    | "uint16"
    | "uint24"
    | "uint32"
    | "uint64"
    | "float"
    | "double"
    | "int8"
    | "int16"
    | "int32"
    | "int64";
} & (
  | {
      category: "color";
    }
  | {
      category: "segmentation";
      largestSegmentId: number | null;
      mappings: Array<string>;
    }
) &
  (
    | DataLayerWKWPartial
    | DataLayerZarrPartial
    | DataLayerN5Partial
    | DataLayerPrecomputedPartial
    | DataLayerZarr3Partial
  );
export type DatasourceConfiguration = {
  id: {
    name: string;
    team: string;
  };
  dataLayers: Array<DataLayer>;
  scale: VoxelSize;
};
