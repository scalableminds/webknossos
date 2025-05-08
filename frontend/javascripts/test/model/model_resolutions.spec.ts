import { describe, it, expect } from "vitest";
import { getMagnificationUnion } from "viewer/model/accessors/dataset_accessor";
import type { Vector3 } from "viewer/constants";
import type { APIDataset } from "types/api_types";
import { convertToDenseMag } from "viewer/model/helpers/mag_info";

describe("Model resolutions", () => {
  it("Simple convertToDenseMag", () => {
    const denseMags = convertToDenseMag([
      [2, 2, 1],
      [4, 4, 2],
    ]);
    expect(denseMags).toEqual([
      [1, 1, 1],
      [2, 2, 1],
      [4, 4, 2],
    ]);
  });

  it("Complex convertToDenseMag", () => {
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

    expect(densify(dataset.dataSource.dataLayers[0])).toEqual(expectedMags[0]);
    expect(densify(dataset.dataSource.dataLayers[1])).toEqual(expectedMags[1]);
  });

  it("Test empty getMagUnion", () => {
    const dataset = {
      dataSource: {
        dataLayers: [],
      },
    } as any as APIDataset;
    const expectedMags: Array<Vector3[]> = [];
    const union = getMagnificationUnion(dataset);
    expect(union).toEqual(expectedMags);
  });

  it("Test getMagUnion", () => {
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
    expect(union).toEqual(expectedMags);
  });

  it("Test getMagUnion with mixed mags", () => {
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
    expect(union).toEqual(expectedMags);
  });
});
