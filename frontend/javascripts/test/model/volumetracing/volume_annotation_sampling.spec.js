/*
 * cube.spec.js
 * @flow
 */
import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import sampleVoxelMapToResolution, {
  applyVoxelMap,
} from "oxalis/model/volumetracing/volume_annotation_sampling";
import Constants, { type Vector2, type Vector4 } from "oxalis/constants";
import anyTest, { type TestInterface } from "ava";
import datasetServerObject from "test/fixtures/dataset_server_object";
import mockRequire from "mock-require";
import sinon from "sinon";

mockRequire.stopAll();

const StoreMock = {
  getState: () => ({
    dataset: datasetServerObject,
    tracing: { skeleton: skeletontracingServerObject },
    datasetConfiguration: { fourBit: false },
  }),
  dispatch: sinon.stub(),
  subscribe: sinon.stub(),
};

mockRequire("oxalis/store", StoreMock);

mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});

type LabeledVoxelsMapAsArray = Array<[Vector4, Uint8Array]>;
// Avoid node caching and make sure all mockRequires are applied
const Cube = mockRequire.reRequire("oxalis/model/bucket_data_handling/data_cube").default;

// Ava's recommendation for Flow types
// https://github.com/avajs/ava/blob/master/docs/recipes/flow.md#typing-tcontext
const test: TestInterface<{
  cube: Cube,
}> = (anyTest: any);

test.beforeEach(t => {
  const mockedLayer = {
    resolutions: [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16], [32, 32, 32]],
  };
  const cube = new Cube([1024, 1024, 1024], 3, "uint32", mockedLayer);
  const pullQueue = {
    add: sinon.stub(),
    pull: sinon.stub(),
  };
  const pushQueue = {
    insert: sinon.stub(),
    push: sinon.stub(),
  };
  cube.initializeWithQueues(pullQueue, pushQueue);

  t.context = {
    cube,
  };
});

function getEmptyVoxelMap() {
  return new Uint8Array(Constants.BUCKET_WIDTH ** 2).fill(0);
}

function labelVoxelInVoxelMap(firstDim: number, secondDim: number, voxelMap: Uint8Array) {
  voxelMap[firstDim * Constants.BUCKET_WIDTH + secondDim] = 1;
}

function getVoxelMapEntry(firstDim: number, secondDim: number, voxelMap: Uint8Array) {
  return voxelMap[firstDim * Constants.BUCKET_WIDTH + secondDim];
}

test("Upsampling an annotation should work in the top left part of a bucket", t => {
  const { cube } = t.context;
  const sourceVoxelMap = getEmptyVoxelMap();
  [[5, 5], [5, 6], [6, 5], [6, 6]].forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap),
  );
  const goalVoxelMap = getEmptyVoxelMap();
  [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
  const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [2, 2, 2],
    1,
    [1, 1, 1],
    0,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [0, 0, 0, 0],
    "The bucket of the upsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        "The labeled voxels of the upsampled voxel map should match the expected labels",
      );
    }
  }
});

test("Upsampling an annotation should work in the top right part of a bucket", t => {
  const { cube } = t.context;
  const sourceVoxelMap = getEmptyVoxelMap();
  [[21, 5], [21, 6], [22, 5], [22, 6]].forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap),
  );
  const goalVoxelMap = getEmptyVoxelMap();
  [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
  const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [2, 2, 2],
    1,
    [1, 1, 1],
    0,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [1, 0, 0, 0],
    "The bucket of the upsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        "The labeled voxels of the upsampled voxel map should match the expected labels",
      );
    }
  }
});

test("Upsampling an annotation should work in the bottom left part of a bucket", t => {
  const { cube } = t.context;
  const sourceVoxelMap = getEmptyVoxelMap();
  [[5, 21], [6, 21], [5, 22], [6, 22]].forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap),
  );
  const goalVoxelMap = getEmptyVoxelMap();
  [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
  const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [2, 2, 2],
    1,
    [1, 1, 1],
    0,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [0, 1, 0, 0],
    "The bucket of the upsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        "The labeled voxels of the upsampled voxel map should match the expected labels",
      );
    }
  }
});

test("Upsampling an annotation should work in the bottom right part of a bucket", t => {
  const { cube } = t.context;
  const sourceVoxelMap = getEmptyVoxelMap();
  [[21, 21], [22, 21], [21, 22], [22, 22]].forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap),
  );
  const goalVoxelMap = getEmptyVoxelMap();
  [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
  const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [2, 2, 2],
    1,
    [1, 1, 1],
    0,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [1, 1, 0, 0],
    "The bucket of the upsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        "The labeled voxels of the upsampled voxel map should match the expected labels",
      );
    }
  }
});

test("Upsampling an annotation where the annotation slice is in the lower part of the bucket should upsample to the correct bucket", t => {
  const { cube } = t.context;
  const sourceVoxelMap = getEmptyVoxelMap();
  [[5, 5], [5, 6], [6, 5], [6, 6]].forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap),
  );
  const goalVoxelMap = getEmptyVoxelMap();
  [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
    ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap),
  );
  const bucket = cube.getOrCreateBucket([0, 0, 0, 1]);
  const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [2, 2, 2],
    1,
    [1, 1, 1],
    0,
    [0, 1, 2],
    40,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [0, 0, 1, 0],
    "The bucket of the upsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        "The labeled voxels of the upsampled voxel map should match the expected labels",
      );
    }
  }
});

test("Upsampling an annotation should work across more than one resolution", t => {
  const { cube } = t.context;
  const sourceVoxelMap = getEmptyVoxelMap();
  [[10, 10], [10, 11], [11, 10], [11, 11]].forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, sourceVoxelMap),
  );
  const goalVoxelMap = getEmptyVoxelMap();
  // scaling [10,10],[11,11] up: 10 ->  20 -> 40 (mod Constants.BUCKET_WIDTH) -> 8; 11 -> 23 -> 47 (mod Constants.BUCKET_WIDTH) -> 15;
  for (let firstDim = 8; firstDim <= 15; firstDim++) {
    for (let secondDim = 8; secondDim <= 15; secondDim++) {
      labelVoxelInVoxelMap(firstDim, secondDim, goalVoxelMap);
    }
  }
  const bucket = cube.getOrCreateBucket([0, 0, 0, 2]);
  const labeledVoxelsMap = new Map([[bucket.zoomedAddress, sourceVoxelMap]]);
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [4, 4, 4],
    2,
    [1, 1, 1],
    0,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [1, 1, 0, 0],
    "The bucket of the upsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        "The labeled voxels of the upsampled voxel map should match the expected labels",
      );
    }
  }
});

test("Downsampling annotation of neighbour buckets should result in one downsampled voxelMap", t => {
  const { cube } = t.context;
  const labeledVoxelsMap = new Map();
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]].forEach(zoomedAddress => {
    const voxelMap = getEmptyVoxelMap();
    [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
      ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
      ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    const bucket = cube.getOrCreateBucket([...zoomedAddress, 0]);
    labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);
  });
  const goalVoxelMap = getEmptyVoxelMap();
  [[0, 0], [16, 0], [0, 16], [16, 16]].forEach(([firstOffset, secondOffset]) => {
    [[5, 5], [5, 6], [6, 5], [6, 6]].forEach(([firstDim, secondDim]) => {
      labelVoxelInVoxelMap(firstDim + firstOffset, secondDim + secondOffset, goalVoxelMap);
    });
  });
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [1, 1, 1],
    0,
    [2, 2, 2],
    1,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [0, 0, 0, 1],
    "The bucket of the downsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        `The labeled voxels of the downsampled voxel map should match the expected labels: ${firstDim}, ${secondDim}, got ${getVoxelMapEntry(
          firstDim,
          secondDim,
          upsampledVoxelMap,
        )} , expected ${getVoxelMapEntry(firstDim, secondDim, goalVoxelMap)}.`,
      );
    }
  }
});

test("Downsampling annotation should work across more than one resolution", t => {
  const { cube } = t.context;
  const labeledVoxelsMap = new Map();
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]].forEach(zoomedAddress => {
    const voxelMap = getEmptyVoxelMap();
    [[10, 10], [10, 11], [10, 12], [10, 13], [11, 10], [11, 11], [11, 12], [11, 13]].forEach(
      ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    [[12, 10], [12, 11], [12, 12], [12, 13], [13, 10], [13, 11], [13, 12], [13, 13]].forEach(
      ([firstDim, secondDim]) => labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
    );
    const bucket = cube.getOrCreateBucket([...zoomedAddress, 0]);
    labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);
  });
  const goalVoxelMap = getEmptyVoxelMap();
  [[0, 0], [8, 0], [0, 8], [8, 8]].forEach(([firstOffset, secondOffset]) => {
    [[2, 2], [2, 3], [3, 2], [3, 3]].forEach(([firstDim, secondDim]) => {
      labelVoxelInVoxelMap(firstDim + firstOffset, secondDim + secondOffset, goalVoxelMap);
    });
  });
  const upsampledVoxelMapPerBucket = sampleVoxelMapToResolution(
    labeledVoxelsMap,
    cube,
    [1, 1, 1],
    0,
    [4, 4, 4],
    2,
    [0, 1, 2],
    5,
  );
  const upsampledVoxelMapAsArray: LabeledVoxelsMapAsArray = Array.from(upsampledVoxelMapPerBucket);
  const bucketZoomedAddress = upsampledVoxelMapAsArray[0][0];
  const upsampledVoxelMap = upsampledVoxelMapAsArray[0][1];
  t.deepEqual(
    bucketZoomedAddress,
    [0, 0, 0, 2],
    "The bucket of the downsampled map should be correct.",
  );
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      t.is(
        getVoxelMapEntry(firstDim, secondDim, upsampledVoxelMap),
        getVoxelMapEntry(firstDim, secondDim, goalVoxelMap),
        `The labeled voxels of the downsampled voxel map should match the expected labels: ${firstDim}, ${secondDim}, got ${getVoxelMapEntry(
          firstDim,
          secondDim,
          upsampledVoxelMap,
        )} , expected ${getVoxelMapEntry(firstDim, secondDim, goalVoxelMap)}.`,
      );
    }
  }
});

test("A labeledVoxelMap should be applied correctly", t => {
  const { cube } = t.context;
  const bucket = cube.getOrCreateBucket([0, 0, 0, 0]);
  const labeledVoxelsMap = new Map();
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
  voxelsToLabel.forEach(([firstDim, secondDim]) =>
    labelVoxelInVoxelMap(firstDim, secondDim, voxelMap),
  );
  labeledVoxelsMap.set(bucket.zoomedAddress, voxelMap);
  const get3DAddress = (voxel2D: Vector2) => [...voxel2D, 5];
  const expectedBucketData = new Uint32Array(Constants.BUCKET_SIZE).fill(0);
  voxelsToLabel.forEach(([firstDim, secondDim]) => {
    const addr = cube.getVoxelIndex([firstDim, secondDim, 5], 0);
    expectedBucketData[addr] = 1;
  });
  applyVoxelMap(labeledVoxelsMap, cube, 1, get3DAddress);
  const labeledBucketData = bucket.getOrCreateData();
  for (let firstDim = 0; firstDim < Constants.BUCKET_WIDTH; firstDim++) {
    for (let secondDim = 0; secondDim < Constants.BUCKET_WIDTH; secondDim++) {
      const addr = cube.getVoxelIndex([firstDim, secondDim, 5], 0);
      t.is(
        labeledBucketData[addr],
        expectedBucketData[addr],
        `Did not apply voxel map at ${[firstDim, secondDim, 5, 1].toString()} correctly.`,
      );
    }
  }
});
