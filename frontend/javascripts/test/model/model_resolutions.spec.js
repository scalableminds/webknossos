import test from "ava";

import {
  ensureDenseLayerResolutions,
  ensureMatchingLayerResolutions,
  convertToDenseResolution,
} from "oxalis/model_initialization";

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
  ensureDenseLayerResolutions(dataset);
  ensureMatchingLayerResolutions(dataset);
  const expectedResolutions = [
    [1, 1, 1],
    [2, 2, 1],
    [4, 4, 1],
    [8, 8, 1],
    [16, 16, 2],
    [32, 32, 4],
  ];

  t.deepEqual(dataset.dataSource.dataLayers[0].resolutions, expectedResolutions);
  t.deepEqual(dataset.dataSource.dataLayers[1].resolutions, expectedResolutions);
});
