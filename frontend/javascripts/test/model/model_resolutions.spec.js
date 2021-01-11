// @noflow
import test from "ava";

import { ensureMatchingLayerResolutions } from "oxalis/model_initialization";
import {
  convertToDenseResolution,
  getResolutionUnion,
} from "oxalis/model/accessors/dataset_accessor";

test("Simple convertToDenseResolution", t => {
  const denseResolutions = convertToDenseResolution([[2, 2, 1], [4, 4, 2]]);
  t.deepEqual(denseResolutions, [[1, 1, 1], [2, 2, 1], [4, 4, 2]]);
});

test("Complex convertToDenseResolution", t => {
  const dataset = {
    dataSource: {
      dataLayers: [
        {
          resolutions: [[2, 2, 1], [4, 4, 1], [8, 8, 1], [16, 16, 2], [32, 32, 4]],
        },
        {
          resolutions: [[32, 32, 4]],
        },
      ],
    },
  };
  ensureMatchingLayerResolutions(dataset);
  const expectedResolutions = {
    "0": [[1, 1, 1], [2, 2, 1], [4, 4, 1], [8, 8, 1], [16, 16, 2], [32, 32, 4]],
    "1": [[1, 1, 1], [2, 2, 2], [4, 4, 4], [8, 8, 8], [16, 16, 16], [32, 32, 4]],
  };
  const densify = layer => convertToDenseResolution(layer.resolutions);

  t.deepEqual(densify(dataset.dataSource.dataLayers[0]), expectedResolutions[0]);
  t.deepEqual(densify(dataset.dataSource.dataLayers[1]), expectedResolutions[1]);
});

test("Test empty getResolutionUnion", t => {
  const dataset = {
    dataSource: {
      dataLayers: [],
    },
  };
  ensureMatchingLayerResolutions(dataset);
  const expectedResolutions = [];
  const union = getResolutionUnion(dataset);

  t.deepEqual(union, expectedResolutions);
});

test("Test getResolutionUnion", t => {
  const dataset = {
    dataSource: {
      dataLayers: [
        {
          resolutions: [[4, 4, 1], [8, 8, 1], [16, 16, 2], [32, 32, 4]],
        },
        {
          resolutions: [[2, 2, 1], [8, 8, 1], [32, 32, 4]],
        },
      ],
    },
  };
  ensureMatchingLayerResolutions(dataset);
  const expectedResolutions = [[2, 2, 1], [4, 4, 1], [8, 8, 1], [16, 16, 2], [32, 32, 4]];
  const union = getResolutionUnion(dataset);

  t.deepEqual(union, expectedResolutions);
});

test("getResolutionUnion should fail since 8-8-1 != 8-8-2", t => {
  const dataset = {
    dataSource: {
      dataLayers: [
        {
          resolutions: [[4, 4, 1], [8, 8, 1], [16, 16, 2], [32, 32, 4]],
        },
        {
          resolutions: [[2, 2, 1], [8, 8, 2], [32, 32, 4]],
        },
      ],
    },
  };

  t.throws(() => ensureMatchingLayerResolutions(dataset));
});
