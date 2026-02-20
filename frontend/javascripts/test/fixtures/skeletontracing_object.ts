import update from "immutability-helper";
import defaultState from "viewer/default_state";
import { colorLayer, initialSkeletonTracing } from "./hybridtracing_object";

export const initialState = update(defaultState, {
  annotation: {
    skeleton: {
      $set: initialSkeletonTracing,
    },
    readOnly: {
      $set: null,
    },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [colorLayer],
      },
    },
  },
});
