// @noflow
import test from "ava";

import { ensureMatchingLayerResolutions } from "oxalis/model_initialization";
import {
  convertToDenseResolution,
  getMostExtensiveResolutions,
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
  const expectedResolutions = [
    [1, 1, 1],
    [2, 2, 1],
    [4, 4, 1],
    [8, 8, 1],
    [16, 16, 2],
    [32, 32, 4],
  ];
  const mostExtensiveResolutions = convertToDenseResolution(getMostExtensiveResolutions(dataset));
  const densify = layer => convertToDenseResolution(layer.resolutions, mostExtensiveResolutions);

  t.deepEqual(densify(dataset.dataSource.dataLayers[0]), expectedResolutions);
  t.deepEqual(densify(dataset.dataSource.dataLayers[1]), expectedResolutions);
});
