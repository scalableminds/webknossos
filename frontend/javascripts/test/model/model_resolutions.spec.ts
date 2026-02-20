import type { APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getMagnificationUnion } from "viewer/model/accessors/dataset_accessor";
import { convertToDenseMags } from "viewer/model/helpers/mag_info";
import { describe, expect, it } from "vitest";

describe("Model mags", () => {
  it("Simple convertToDenseMags", () => {
    const denseMags = convertToDenseMags([
      [2, 2, 1],
      [4, 4, 2],
    ]);
    expect(denseMags).toEqual([
      [1, 1, 1],
      [2, 2, 1],
      [4, 4, 2],
    ]);
  });

  it("Complex convertToDenseMags", () => {
    const dataset = {
      dataSource: {
        dataLayers: [
          {
            mags: [
              { mag: [16, 16, 2] },
              { mag: [2, 2, 1] },
              { mag: [4, 4, 1] },
              { mag: [8, 8, 1] },
              { mag: [32, 32, 4] },
            ] as { mag: Vector3 }[],
          },
          {
            mags: [{ mag: [32, 32, 4] }] as { mag: Vector3 }[],
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

    const densify = (layer: { mags: { mag: Vector3 }[] }) =>
      convertToDenseMags(layer.mags.map((magObj) => magObj.mag));

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
            mags: [
              { mag: [4, 4, 1] },
              { mag: [8, 8, 1] },
              { mag: [16, 16, 2] },
              { mag: [32, 32, 4] },
            ],
          },
          {
            mags: [{ mag: [2, 2, 1] }, { mag: [8, 8, 1] }, { mag: [32, 32, 4] }],
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
            mags: [
              { mag: [4, 4, 1] },
              { mag: [8, 8, 1] },
              { mag: [16, 16, 2] },
              { mag: [32, 32, 4] },
            ],
          },
          {
            mags: [{ mag: [2, 2, 1] }, { mag: [8, 8, 2] }, { mag: [32, 32, 4] }],
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
