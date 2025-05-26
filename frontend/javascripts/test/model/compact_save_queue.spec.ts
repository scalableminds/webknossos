import { removeSubsequentUpdateBBoxActions } from "viewer/model/helpers/compaction/compact_save_queue";
import {
  updateUserBoundingBoxInSkeletonTracing,
  type UpdateUserBoundingBoxInSkeletonTracingAction,
  updateUserBoundingBoxInVolumeTracing,
  type UpdateUserBoundingBoxInVolumeTracingAction,
} from "viewer/model/sagas/update_actions";
import type { SaveQueueEntry } from "viewer/store";
import { describe, expect, it } from "vitest";

describe("Compact Save Queue", () => {
  it("UpdateUserBoundingBoxActions of the same tracing should be compacted", () => {
    const actions: SaveQueueEntry[] = [
      {
        version: -1,
        transactionId: "eq3scfgvoa",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347590,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInVolumeTracing(
            3,
            {
              boundingBox: {
                min: [3224, 3955, 944],
                max: [3225, 4112, 956],
              },
            },
            "volumeTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "msk6wwebqf",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347633,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInVolumeTracing(
            3,
            {
              boundingBox: {
                min: [3224, 3955, 944],
                max: [3225, 4055, 956],
              },
            },
            "volumeTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "1clexor0ve",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347637,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInVolumeTracing(
            3,
            {
              boundingBox: {
                min: [3224, 3955, 944],
                max: [3225, 4047, 956],
              },
            },
            "volumeTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "eq3scfgvoa",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347590,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInSkeletonTracing(
            3,
            {
              boundingBox: {
                min: [322, 3955, 944],
                max: [323, 4112, 956],
              },
            },
            "skeletonTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "msk6wwebqf",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347633,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInSkeletonTracing(
            3,
            {
              boundingBox: {
                min: [3224, 395, 944],
                max: [3225, 495, 956],
              },
            },
            "skeletonTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "1clexor0ve",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347637,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInSkeletonTracing(
            3,
            {
              boundingBox: {
                min: [3224, 3955, 900],
                max: [3225, 4047, 912],
              },
            },
            "skeletonTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
    ];
    const compactedActions = removeSubsequentUpdateBBoxActions(actions);
    expect(compactedActions).toHaveLength(2);
    const volumeActionBatch = compactedActions[0];
    const skeletonActionBatch = compactedActions[1];
    expect(skeletonActionBatch.actions[0].name).toBe("updateUserBoundingBoxInSkeletonTracing");
    expect(volumeActionBatch.actions[0].name).toBe("updateUserBoundingBoxInVolumeTracing");

    const volumeActionValue = (
      volumeActionBatch?.actions[0] as UpdateUserBoundingBoxInVolumeTracingAction
    ).value;
    expect(volumeActionValue).not.toBeNull();
    if (volumeActionValue == null) {
      throw new Error("volumeActionValue must not be null");
    }

    expect(volumeActionValue.boundingBox).toEqual({
      topLeft: [3224, 3955, 944],
      width: 1,
      height: 92,
      depth: 12,
    });

    const skeletonActionValue = (
      skeletonActionBatch?.actions[0] as UpdateUserBoundingBoxInSkeletonTracingAction
    ).value;
    expect(skeletonActionValue).not.toBeNull();
    if (skeletonActionValue == null) {
      throw new Error("skeletonActionValue must not be null");
    }

    expect(skeletonActionValue.boundingBox).toEqual({
      topLeft: [3224, 3955, 900],
      width: 1,
      height: 92,
      depth: 12,
    });

    if (skeletonActionValue == null) {
      throw new Error("skeletonActionValue must not be null");
    }
  });

  it("UpdateUserBoundingBoxActions should be not compacted for different props", () => {
    const actions: SaveQueueEntry[] = [
      {
        version: -1,
        transactionId: "eq3scfgvoa",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347590,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInVolumeTracing(
            3,
            {
              name: "test1",
            },
            "volumeTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "msk6wwebqf",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347633,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInVolumeTracing(
            3,
            {
              boundingBox: {
                min: [3224, 3955, 944],
                max: [3225, 4055, 956],
              },
            },
            "volumeTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
      {
        version: -1,
        transactionId: "1clexor0ve",
        transactionGroupCount: 1,
        transactionGroupIndex: 0,
        timestamp: 1747994347637,
        authorId: "123",
        actions: [
          updateUserBoundingBoxInVolumeTracing(
            3,
            {
              boundingBox: {
                min: [3224, 3955, 944],
                max: [3225, 4047, 956],
              },
            },
            "volumeTracing1",
          ),
        ],
        stats: undefined,
        info: "",
      },
    ];

    const compactedActions = removeSubsequentUpdateBBoxActions(actions);
    expect(compactedActions).toHaveLength(2);
  });
});
