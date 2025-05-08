import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import { tracing as volumetracingServerObject } from "test/fixtures/volumetracing_server_objects";
import type { LabeledVoxelsMap, Vector3, Vector4 } from "oxalis/constants";
import Constants from "oxalis/constants";
import { describe, it, beforeEach, vi, expect } from "vitest";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { MagInfo } from "oxalis/model/helpers/mag_info";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type DataCubeType from "oxalis/model/bucket_data_handling/data_cube";
import { assertNonNullBucket } from "oxalis/model/bucket_data_handling/bucket";
import DataCube from "oxalis/model/bucket_data_handling/data_cube";
import sampleVoxelMapToMag, {
  applyVoxelMap,
} from "oxalis/model/volumetracing/volume_annotation_sampling";

// Mock modules
vi.mock("oxalis/store", () => {
  return {
    default: {
      getState: () => ({
        dataset: datasetServerObject,
        annotation: {
          skeleton: skeletontracingServerObject,
          volume: volumetracingServerObject,
        },
        datasetConfiguration: {
          fourBit: false,
        },
      }),
      dispatch: vi.fn(),
      subscribe: vi.fn(),
    },
  };
});

vi.mock("oxalis/model/sagas/root_saga", () => {
  return {
    default: function* () {
      yield;
    },
  };
});

type LabeledVoxelsMapAsArray = Array<[Vector4, Uint8Array]>;

// Test context type
type TestContext = {
  cube: DataCubeType;
};

// Helper functions
function getEmptyVoxelMap() {
  return new Uint8Array(Constants.BUCKET_WIDTH ** 2).fill(0);
}

function labelVoxelInVoxelMap(firstDim: number, secondDim: number, voxelMap: Uint8Array) {
  voxelMap[firstDim * Constants.BUCKET_WIDTH + secondDim] = 1;
}

function getVoxelMapEntry(firstDim: number, secondDim: number, voxelMap: Uint8Array) {
  return voxelMap[firstDim * Constants.BUCKET_WIDTH + secondDim];
}

describe("Volume Annotation Sampling", () => {
  let context: TestContext;

  const cubeBoundingBox = new BoundingBox({ min: [1, 2, 3], max: [1023, 1024, 1025] });

  beforeEach(() => {
    const mockedLayer = {
      resolutions: [
        [1, 1, 1],
        [2, 2, 2],
        [4, 4, 4],
        [8, 8, 8],
        [16, 16, 16],
        [32, 32, 32],
      ] as Vector3[],
    };
    const magInfo = new MagInfo(mockedLayer.resolutions);
    const cube = new DataCube(cubeBoundingBox, [], magInfo, "uint32", false, "layerName");
    const pullQueue = {
      add: vi.fn(),
      pull: vi.fn(),
    };
    const pushQueue = {
      insert: vi.fn(),
      push: vi.fn(),
    };
    // @ts-expect-error
    cube.initializeWithQueues(pullQueue, pushQueue);
    context = {
      cube,
    };
  });

  it("Upsampling an annotation should work in the top left part of a bucket", () => {
    const { cube } = context;
    const sourceVoxelMap = getEmptyVoxelMap();
    [
      [5, 5],
      [5, 6],
      [6, 5],
      [6, 6],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap));
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [11, 10],
      [11, 11],
      [11, 12],
      [11, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    [
      [12, 10],
      [12, 11],
      [12, 12],
      [12, 13],
      [13, 10],
      [13, 11],
      [13, 12],
      [13, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [2, 2, 2],
      1,
      [1, 1, 1],
      0,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([0, 0, 0, 0, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Upsampling an annotation should work in the top right part of a bucket", () => {
    const { cube } = context;
    const sourceVoxelMap = getEmptyVoxelMap();
    [
      [21, 5],
      [21, 6],
      [22, 5],
      [22, 6],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap));
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [11, 10],
      [11, 11],
      [11, 12],
      [11, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    [
      [12, 10],
      [12, 11],
      [12, 12],
      [12, 13],
      [13, 10],
      [13, 11],
      [13, 12],
      [13, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [2, 2, 2],
      1,
      [1, 1, 1],
      0,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([1, 0, 0, 0, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Upsampling an annotation should work in the bottom left part of a bucket", () => {
    const { cube } = context;
    const sourceVoxelMap = getEmptyVoxelMap();
    [
      [5, 21],
      [6, 21],
      [5, 22],
      [6, 22],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap));
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [11, 10],
      [11, 11],
      [11, 12],
      [11, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    [
      [12, 10],
      [12, 11],
      [12, 12],
      [12, 13],
      [13, 10],
      [13, 11],
      [13, 12],
      [13, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [2, 2, 2],
      1,
      [1, 1, 1],
      0,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([0, 1, 0, 0, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Upsampling an annotation should work in the bottom right part of a bucket", () => {
    const { cube } = context;
    const sourceVoxelMap = getEmptyVoxelMap();
    [
      [21, 21],
      [22, 21],
      [21, 22],
      [22, 22],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap));
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [11, 10],
      [11, 11],
      [11, 12],
      [11, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    [
      [12, 10],
      [12, 11],
      [12, 12],
      [12, 13],
      [13, 10],
      [13, 11],
      [13, 12],
      [13, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [2, 2, 2],
      1,
      [1, 1, 1],
      0,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([1, 1, 0, 0, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Upsampling an annotation where the annotation slice is in the lower part of the bucket should upsample to the correct bucket", () => {
    const { cube } = context;
    const sourceVoxelMap = getEmptyVoxelMap();
    [
      [5, 5],
      [5, 6],
      [6, 5],
      [6, 6],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap));
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [11, 10],
      [11, 11],
      [11, 12],
      [11, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    [
      [12, 10],
      [12, 11],
      [12, 12],
      [12, 13],
      [13, 10],
      [13, 11],
      [13, 12],
      [13, 13],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap));
    const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [2, 2, 2],
      1,
      [1, 1, 1],
      0,
      [0, 1, 2],
      40,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([0, 0, 1, 0, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Upsampling an annotation should work across more than one mag", () => {
    const { cube } = context;
    const sourceVoxelMap = getEmptyVoxelMap();
    [
      [10, 10],
      [10, 11],
      [11, 10],
      [11, 11],
    ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap));
    const goalVoxelMap = getEmptyVoxelMap();

    // scaling [10,10],[11,11] up: 10 ->  20 -> 40 (mod Constants.BUCKET_WIDTH) -> 8; 11 -> 23 -> 47 (mod Constants.BUCKET_WIDTH) -> 15;
    for (let firstDim = 8; firstDim <= 15; firstDim++) {
      for (let secondDim = 8; secondDim <= 15; secondDim++) {
        labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap);
      }
    }

    const bucket = cube.getOrCreateBucket([0, 0, 0, 2]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [4, 4, 4],
      2,
      [1, 1, 1],
      0,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([1, 1, 0, 0, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Downsampling annotation of neighbour buckets should result in one downsampled voxelMap", () => {
    const { cube } = context;
    const labeledVoxelsMap = new Map();
    (
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ] as Vector3[]
    ).forEach((zoomedAddress) => {
      const voxelMap = getEmptyVoxelMap();
      [
        [10, 10],
        [10, 11],
        [10, 12],
        [10, 13],
        [11, 10],
        [11, 11],
        [11, 12],
        [11, 13],
      ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap));
      [
        [12, 10],
        [12, 11],
        [12, 12],
        [12, 13],
        [13, 10],
        [13, 11],
        [13, 12],
        [13, 13],
      ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap));
      const bucket = cube.getOrCreateBucket([...zoomedAddress, 0]);
      assertNonNullBucket(bucket);
      labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);
    });
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [0, 0],
      [16, 0],
      [0, 16],
      [16, 16],
    ].forEach(([firstOffset, secondOffset]) => {
      [
        [5, 5],
        [5, 6],
        [6, 5],
        [6, 6],
      ].forEach(([firstDim, secondDim]) => {
        labelVoxelInVoxelMap(firstDim + firstOffset, secondDim + secondOffset, goalVoxelMap);
      });
    });
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [1, 1, 1],
      0,
      [2, 2, 2],
      1,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([0, 0, 0, 1, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("Downsampling annotation should work across more than one mag", () => {
    const { cube } = context;
    const labeledVoxelsMap = new Map();
    (
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ] as Vector3[]
    ).forEach((zoomedAddress) => {
      const voxelMap = getEmptyVoxelMap();
      [
        [10, 10],
        [10, 11],
        [10, 12],
        [10, 13],
        [11, 10],
        [11, 11],
        [11, 12],
        [11, 13],
      ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap));
      [
        [12, 10],
        [12, 11],
        [12, 12],
        [12, 13],
        [13, 10],
        [13, 11],
        [13, 12],
        [13, 13],
      ].forEach(([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap));
      const bucket = cube.getOrCreateBucket([...zoomedAddress, 0]);
      assertNonNullBucket(bucket);
      labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);
    });
    const goalVoxelMap = getEmptyVoxelMap();
    [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ].forEach(([firstOffset, secondOffset]) => {
      [
        [2, 2],
        [2, 3],
        [3, 2],
        [3, 3],
      ].forEach(([firstDim, secondDim]) => {
        labelVoxelInVoxelMap(firstDim + firstOffset, secondDim + secondOffset, goalVoxelMap);
      });
    });
    const upsampledVoxelMapPerBucket = sampleVoxelMapToMag(
      labeledVoxelsMap,
      cube,
      [1, 1, 1],
      0,
      [4, 4, 4],
      2,
      [0, 1, 2],
      5,
    );
    const upsampledVoxelMapAsArray = Array.from(
      upsampledVoxelMapPerBucket,
    ) as LabeledVoxelsMapAsArray;
    const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
    const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
    expect(bucketZoomedAddress).toEqual([0, 0, 0, 2, []]);

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        expect(getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap)).toBe(
          getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        );
      }
    }
  });

  it("A labeledVoxelMap should be applied correctly", () => {
    const { cube } = context;
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap: LabeledVoxelsMap = new Map();
    const voxelMap = getEmptyVoxelMap();
    const voxelsToLabel = [
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [11, 10],
      [11, 11],
      [11, 12],
      [11, 13],
    ];
    const Z = 5;
    voxelsToLabel.forEach(([firstDim, secondDim]) =>
      labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);

    const get3DAddress = (x: number, y: number, out: Vector3 | Float32Array) => {
      out[0] = x;
      out[1] = y;
      out[2] = Z;
    };

    const expectedBucketData = new Uint32Array(Constants.BUCKET_SIZE).fill(0);
    voxelsToLabel.forEach(([firstDim, secondDim]) => {
      const addr = cube.getVoxelIndex([firstDim, secondDim, Z], 0);
      expectedBucketData[addr] = 1;
    });
    applyVoxelMap(labeledVoxelsMap, cube, 1, get3DAddress, 1, 2, true);
    const labeledBucketData = bucket.getOrCreateData();

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        const addr = cube.getVoxelIndex([firstDim, secondDim, Z], 0);
        expect(labeledBucketData[addr]).toBe(expectedBucketData[addr]);
      }
    }
  });

  it("A labeledVoxelMap should be applied correctly (ignore values outside of bbox)", () => {
    const { cube } = context;
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap: LabeledVoxelsMap = new Map();
    const voxelMap = getEmptyVoxelMap();
    const voxelsToLabel = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 0],
    ];
    const Z = 5;
    voxelsToLabel.forEach(([firstDim, secondDim]) =>
      labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);

    const get3DAddress = (x: number, y: number, out: Vector3 | Float32Array) => {
      out[0] = x;
      out[1] = y;
      out[2] = Z;
    };

    const expectedBucketData = new Uint32Array(Constants.BUCKET_SIZE).fill(0);
    voxelsToLabel.forEach(([firstDim, secondDim]) => {
      if (
        firstDim < cubeBoundingBox.min[0] ||
        secondDim < cubeBoundingBox.min[1] ||
        firstDim >= cubeBoundingBox.max[0] ||
        secondDim >= cubeBoundingBox.max[1]
      ) {
        return;
      }
      const addr = cube.getVoxelIndex([firstDim, secondDim, Z], 0);
      expectedBucketData[addr] = 1;
    });
    applyVoxelMap(labeledVoxelsMap, cube, 1, get3DAddress, 1, 2, true);
    const labeledBucketData = bucket.getOrCreateData();

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        const addr = cube.getVoxelIndex([firstDim, secondDim, Z], 0);
        expect(labeledBucketData[addr]).toBe(expectedBucketData[addr]);
      }
    }
  });

  it("A labeledVoxelMap should be applied correctly (ignore all values outside of z)", () => {
    const { cube } = context;
    const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
    assertNonNullBucket(bucket);
    const labeledVoxelsMap: LabeledVoxelsMap = new Map();
    const voxelMap = getEmptyVoxelMap();
    const voxelsToLabel = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 0],
    ];
    const Z = 0;
    voxelsToLabel.forEach(([firstDim, secondDim]) =>
      labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);

    const get3DAddress = (x: number, y: number, out: Vector3 | Float32Array) => {
      out[0] = x;
      out[1] = y;
      out[2] = Z;
    };

    const expectedBucketData = new Uint32Array(Constants.BUCKET_SIZE).fill(0);
    applyVoxelMap(labeledVoxelsMap, cube, 1, get3DAddress, 1, 2, true);
    const labeledBucketData = bucket.getOrCreateData();

    for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
      for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
        const addr = cube.getVoxelIndex([firstDim, secondDim, Z], 0);
        expect(labeledBucketData[addr]).toBe(expectedBucketData[addr]);
      }
    }
  });
});
