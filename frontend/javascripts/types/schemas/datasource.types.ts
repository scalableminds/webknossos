// This file is only for documentation:
// Types which were used for creating the datasource.schema.js
// The `flow2schema` node module has been used for conversion.
// Please note that some manual changes to the schema are required.
type Vector3 = [number, number, number];
type BoundingBox = {
  topLeft: Vector3;
  width: number;
  height: number;
  depth: number;
};
type DataLayerWKWPartial = {
  dataFormat: "wkw";
  boundingBox: BoundingBox;
  wkwResolutions: Array<{
    resolution: number | Vector3;
    cubeLength: number;
  }>;
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
};
type DataLayerZarrPartial = BaseRemoteLayer & {
  dataFormat: "zarr";
};
type DataLayerN5Partial = BaseRemoteLayer & {
  dataFormat: "n5";
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
  (DataLayerWKWPartial | DataLayerZarrPartial | DataLayerN5Partial);
export type DatasourceConfiguration = {
  id: {
    name: string;
    team: string;
  };
  dataLayers: Array<DataLayer>;
  scale: Vector3;
};
