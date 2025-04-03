import update from "immutability-helper";
import type { SkeletonTracing } from "oxalis/store";
import { initialState as defaultState } from "test/fixtures/volumetracing_object";

import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import { MISSING_GROUP_ID } from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { TreeTypeEnum } from "oxalis/constants";
import type { APIColorLayer } from "types/api_flow_types";

const colorLayer: APIColorLayer = {
  name: "color",
  category: "color",
  boundingBox: {
    topLeft: [0, 0, 0],
    width: 256,
    height: 256,
    depth: 256,
  },
  resolutions: [
    [1, 1, 1],
    [2, 2, 1],
    [4, 4, 1],
    [8, 8, 2],
    [16, 16, 4],
  ],
  elementClass: "uint8",
  coordinateTransformations: null,
  additionalAxes: [],
};

export const initialSkeletonTracing: SkeletonTracing = {
  type: "skeleton",
  createdTimestamp: 0,
  tracingId: "tracingId",
  trees: {},
  treeGroups: [],
  activeGroupId: null,
  activeTreeId: 1,
  activeNodeId: null,
  cachedMaxNodeId: 0,
  boundingBox: null,
  userBoundingBoxes: [],
  navigationList: {
    list: [],
    activeIndex: -1,
  },
  showSkeletons: true,
  additionalAxes: [],
};
initialSkeletonTracing.trees[1] = {
  treeId: 1,
  name: "TestTree",
  nodes: new DiffableMap(),
  timestamp: Date.now(),
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  color: [23, 23, 23],
  isVisible: true,
  groupId: MISSING_GROUP_ID,
  type: TreeTypeEnum.DEFAULT,
  edgesAreVisible: true,
  metadata: [],
};
initialSkeletonTracing.trees[2] = {
  treeId: 2,
  name: "TestAgglomerateTree",
  nodes: new DiffableMap(),
  timestamp: Date.now(),
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  color: [23, 23, 23],
  isVisible: true,
  groupId: MISSING_GROUP_ID,
  type: TreeTypeEnum.AGGLOMERATE,
  edgesAreVisible: true,
  metadata: [],
};

export const initialState = update(defaultState, {
  annotation: {
    skeleton: {
      $set: initialSkeletonTracing,
    },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [...defaultState.dataset.dataSource.dataLayers, colorLayer],
      },
    },
  },
});
