import { removeSubsequentUpdateBBoxActions } from "viewer/model/helpers/compaction/compact_save_queue";
import { describe, expect, it } from "vitest";

describe("Compact Save Queue", () => {
  it("UpdateUserBoundingBoxActions should be compacted", () => {
    const actions = [
      {
        version: -1,
        transactionId: "eq3scfgvoa",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347590,
        authorId: "123",
        actions: [
          {
            name: "updateUserBoundingBoxInSkeletonTracing",
            value: {
              boundingBoxId: 3,
              actionTracingId: "f33b5d13-3b4a-4e98-abfc-64bf7ca82002",
              updatedProps: {
                boundingBox: {
                  topLeft: [3224, 3955, 944],
                  width: 1,
                  height: 157,
                  depth: 12,
                },
              },
              hasUpdatedBoundingBox: true,
              hasUpdatedName: false,
              hasUpdatedColor: false,
            },
          },
        ],
        stats: {
          "4bb38dd3-fa3a-4034-9608-beedb2ecfc10": {
            segmentCount: 4,
          },
          "f33b5d13-3b4a-4e98-abfc-64bf7ca82002": {
            treeCount: 6,
            nodeCount: 28,
            edgeCount: 23,
            branchPointCount: 0,
          },
        },
        info: '["INITIALIZE_CONNECTOME_TRACING","SET_TD_CAMERA_WITHOUT_TIME_TRACKING * 5","SET_INPUT_CATCHER_RECTS","SET_TD_CAMERA_WITHOUT_TIME_TRACKING","UPDATE_CONNECTOME_FILE_LIST","SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER * 4","SET_TOOL","CHANGE_USER_BOUNDING_BOX * 2","SET_TD_CAMERA_WITHOUT_TIME_TRACKING","CHANGE_USER_BOUNDING_BOX * 3"]',
      },
      {
        version: -1,
        transactionId: "msk6wwebqf",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347633,
        authorId: "123",
        actions: [
          {
            name: "updateUserBoundingBoxInSkeletonTracing",
            value: {
              boundingBoxId: 3,
              actionTracingId: "f33b5d13-3b4a-4e98-abfc-64bf7ca82002",
              updatedProps: {
                boundingBox: {
                  topLeft: [3224, 3955, 944],
                  width: 1,
                  height: 100,
                  depth: 12,
                },
              },
              hasUpdatedBoundingBox: true,
              hasUpdatedName: false,
              hasUpdatedColor: false,
            },
          },
        ],
        stats: {
          "4bb38dd3-fa3a-4034-9608-beedb2ecfc10": {
            segmentCount: 4,
          },
          "f33b5d13-3b4a-4e98-abfc-64bf7ca82002": {
            treeCount: 6,
            nodeCount: 28,
            edgeCount: 23,
            branchPointCount: 0,
          },
        },
        info: '["INITIALIZE_CONNECTOME_TRACING","SET_TD_CAMERA_WITHOUT_TIME_TRACKING * 5","SET_INPUT_CATCHER_RECTS","SET_TD_CAMERA_WITHOUT_TIME_TRACKING","UPDATE_CONNECTOME_FILE_LIST","SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER * 4","SET_TOOL","CHANGE_USER_BOUNDING_BOX * 2","SET_TD_CAMERA_WITHOUT_TIME_TRACKING","CHANGE_USER_BOUNDING_BOX * 3"]',
      },
      {
        version: -1,
        transactionId: "1clexor0ve",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347637,
        authorId: "123",
        actions: [
          {
            name: "updateUserBoundingBoxInVolumeTracing",
            value: {
              boundingBoxId: 3,
              actionTracingId: "4bb38dd3-fa3a-4034-9608-beedb2ecfc10",
              updatedProps: {
                boundingBox: {
                  topLeft: [3224, 3955, 944],
                  width: 1,
                  height: 92,
                  depth: 12,
                },
              },
              hasUpdatedBoundingBox: true,
              hasUpdatedName: false,
              hasUpdatedColor: false,
            },
          },
        ],
        stats: {
          "4bb38dd3-fa3a-4034-9608-beedb2ecfc10": {
            segmentCount: 4,
          },
          "f33b5d13-3b4a-4e98-abfc-64bf7ca82002": {
            treeCount: 6,
            nodeCount: 28,
            edgeCount: 23,
            branchPointCount: 0,
          },
        },
        info: '["INITIALIZE_CONNECTOME_TRACING","SET_TD_CAMERA_WITHOUT_TIME_TRACKING * 5","SET_INPUT_CATCHER_RECTS","SET_TD_CAMERA_WITHOUT_TIME_TRACKING","UPDATE_CONNECTOME_FILE_LIST","SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER * 4","SET_TOOL","CHANGE_USER_BOUNDING_BOX * 2","SET_TD_CAMERA_WITHOUT_TIME_TRACKING","CHANGE_USER_BOUNDING_BOX * 3"]',
      },
    ];

    const compactedActions = removeSubsequentUpdateBBoxActions(actions);
    expect(compactedActions).toHaveLength(2);
    const latestSkeletonTracingAction = compactedActions.find(
      (action) => action.actions[0].name === "updateUserBoundingBoxInSkeletonTracing",
    );
    expect(latestSkeletonTracingAction).toBeDefined();
    expect(latestSkeletonTracingAction?.actions[0].value.updatedProps.boundingBox).toEqual({
      topLeft: [3224, 3955, 944],
      width: 1,
      height: 100,
      depth: 12,
    });
  });
});
