import "test/mocks/lz4";
import test from "ava";
import { getResolutionUnion } from "oxalis/model/accessors/dataset_accessor";
import type { Vector3 } from "oxalis/constants";
import type { APIDataset } from "types/api_flow_types";
import { convertToDenseResolution } from "oxalis/model/helpers/resolution_info";

test("Simple convertToDenseResolution", (t) => {
  const denseResolutions = convertToDenseResolution([
    [2, 2, 1],
    [4, 4, 2],
  ]);
  t.deepEqual(denseResolutions, [
    [1, 1, 1],
    [2, 2, 1],
    [4, 4, 2],
  ]);
});
test("Complex convertToDenseResolution", (t) => {
  const dataset = {
    dataSource: {
      dataLayers: [
        {
          resolutions: [
            [16, 16, 2],
            [2, 2, 1],
            [4, 4, 1],
            [8, 8, 1],
            [32, 32, 4],
          ] as Vector3[],
        },
        {
          resolutions: [[32, 32, 4]] as Vector3[],
        },
      ],
    },
  };

  const expectedResolutions = {
    "0": [
      [1, 1, 1],
      [2, 2, 1],
      [4, 4, 1],
      [8, 8, 1],
      [16, 16, 2],
      [32, 32, 4],
    ] as Vector3[],
    "1": [
      [1, 1, 1],
      [2, 2, 2],
      [4, 4, 4],
      [8, 8, 4],
      [16, 16, 4],
      [32, 32, 4],
    ] as Vector3[],
  };

  const densify = (layer: { resolutions: Vector3[] }) =>
    convertToDenseResolution(layer.resolutions);

  t.deepEqual(densify(dataset.dataSource.dataLayers[0]), expectedResolutions[0]);
  t.deepEqual(densify(dataset.dataSource.dataLayers[1]), expectedResolutions[1]);
});
test("Test empty getResolutionUnion", (t) => {
  const dataset = {
    dataSource: {
      dataLayers: [],
    },
  } as any as APIDataset;
  const expectedResolutions: Array<Vector3[]> = [];
  const union = getResolutionUnion(dataset);
  t.deepEqual(union, expectedResolutions);
});
test("Test getResolutionUnion", (t) => {
  const dataset = {
    dataSource: {
      dataLayers: [
        {
          resolutions: [
            [4, 4, 1],
            [8, 8, 1],
            [16, 16, 2],
            [32, 32, 4],
          ],
        },
        {
          resolutions: [
            [2, 2, 1],
            [8, 8, 1],
            [32, 32, 4],
          ],
        },
      ],
    },
  } as any as APIDataset;
  const expectedResolutions = [[[2, 2, 1]], [[4, 4, 1]], [[8, 8, 1]], [[16, 16, 2]], [[32, 32, 4]]];
  const union = getResolutionUnion(dataset);
  t.deepEqual(union, expectedResolutions);
});

test("Test getResolutionUnion with mixed mags", (t) => {
  const dataset = {
    dataSource: {
      dataLayers: [
        {
          resolutions: [
            [4, 4, 1],
            [8, 8, 1],
            [16, 16, 2],
            [32, 32, 4],
          ],
        },
        {
          resolutions: [
            [2, 2, 1],
            [8, 8, 2],
            [32, 32, 4],
          ],
        },
      ],
    },
  } as any as APIDataset;
  const expectedResolutions = [
    [[2, 2, 1]],
    [[4, 4, 1]],
    [
      [8, 8, 1],
      [8, 8, 2],
    ],
    [[16, 16, 2]],
    [[32, 32, 4]],
  ];
  const union = getResolutionUnion(dataset);
  t.deepEqual(union, expectedResolutions);
});
