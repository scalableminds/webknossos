import "test/mocks/lz4";
import test from "ava";
import { getMagnificationUnion } from "oxalis/model/accessors/dataset_accessor";
import type { Vector3 } from "oxalis/constants";
import type { APIDataset } from "types/api_flow_types";
import { convertToDenseMag } from "oxalis/model/helpers/mag_info";

test("Simple convertToDenseMag", (t) => {
  const denseMags = convertToDenseMag([
    [2, 2, 1],
    [4, 4, 2],
  ]);
  t.deepEqual(denseMags, [
    [1, 1, 1],
    [2, 2, 1],
    [4, 4, 2],
  ]);
});
test("Complex convertToDenseMag", (t) => {
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

  const expectedMags = {
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

  const densify = (layer: { resolutions: Vector3[] }) => convertToDenseMag(layer.resolutions);

  t.deepEqual(densify(dataset.dataSource.dataLayers[0]), expectedMags[0]);
  t.deepEqual(densify(dataset.dataSource.dataLayers[1]), expectedMags[1]);
});
test("Test empty getMagUnion", (t) => {
  const dataset = {
    dataSource: {
      dataLayers: [],
    },
  } as any as APIDataset;
  const expectedMags: Array<Vector3[]> = [];
  const union = getMagnificationUnion(dataset);
  t.deepEqual(union, expectedMags);
});
test("Test getMagUnion", (t) => {
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
  const expectedMags = [[[2, 2, 1]], [[4, 4, 1]], [[8, 8, 1]], [[16, 16, 2]], [[32, 32, 4]]];
  const union = getMagnificationUnion(dataset);
  t.deepEqual(union, expectedMags);
});

test("Test getMagUnion with mixed mags", (t) => {
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
  const expectedMags = [
    [[2, 2, 1]],
    [[4, 4, 1]],
    [
      [8, 8, 1],
      [8, 8, 2],
    ],
    [[16, 16, 2]],
    [[32, 32, 4]],
  ];
  const union = getMagnificationUnion(dataset);
  t.deepEqual(union, expectedMags);
});
