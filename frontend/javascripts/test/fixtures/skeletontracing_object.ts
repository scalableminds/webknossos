import update from "immutability-helper";
import { initialSkeletonTracing, colorLayer } from "./hybridtracing_object";
import defaultState from "viewer/default_state";

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
