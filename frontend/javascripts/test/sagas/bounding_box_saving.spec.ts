import { AnnotationLayerEnum } from "types/api_types";
import { removeSubsequentUpdateBBoxActions } from "viewer/model/helpers/compaction/compact_save_queue";
import { diffBoundingBoxes } from "viewer/model/sagas/skeletontracing_saga";
import {
  updateUserBoundingBoxInSkeletonTracing,
  type UpdateUserBoundingBoxInSkeletonTracingAction,
  updateUserBoundingBoxInVolumeTracing,
  type UpdateUserBoundingBoxInVolumeTracingAction,
} from "viewer/model/sagas/update_actions";
import type { SaveQueueEntry, UserBoundingBox } from "viewer/store";
import { describe, expect, it } from "vitest";

describe("Bounding box diffing and compaction", () => {
  it("should create correct update actions when diffing user bounding boxes", () => {
    const oldBboxes: UserBoundingBox[] = [
      {
        id: 1,
        boundingBox: {
          min: [1, 2, 3],
          max: [10, 20, 30],
        },
        name: "bbox 1",
        color: [1, 1, 1],
        isVisible: true,
      },
      {
        id: 2,
        boundingBox: {
          min: [1, 10, 3],
          max: [10, 20, 30],
        },
        name: "bbox 2",
        color: [1, 2, 3],
        isVisible: true,
      },
    ];
    const newBboxes: UserBoundingBox[] = [
      // Removed 1
      // Changed 2
      {
        id: 2,
        boundingBox: {
          min: [1, 5, 3], // <-- changed
          max: [10, 20, 30],
        },
        name: "bbox 2",
        color: [1, 1, 1], // <-- changed
        isVisible: false, // <-- changed
      },
      // Added 3
      {
        id: 3,
        boundingBox: {
          min: [1, 10, 3],
          max: [10, 20, 30],
        },
        name: "bbox 3",
        color: [1, 1, 1],
        isVisible: false,
      },
    ];

    const diff = Array.from(
      diffBoundingBoxes(oldBboxes, newBboxes, "skeletonTracing1", AnnotationLayerEnum.Skeleton),
    );

    expect(diff.length).toBe(4);

    const [deleteFirst, addThird, updateVisibilityForSecond, changeSecond] = diff;

    expect(deleteFirst.name).toBe("deleteUserBoundingBoxInSkeletonTracing");
    expect(deleteFirst.value).toEqual({
      boundingBoxId: 1,
      actionTracingId: "skeletonTracing1",
    });

    expect(addThird.name).toBe("addUserBoundingBoxInSkeletonTracing");
    expect(addThird.value).toEqual({
      boundingBox: {
        ...newBboxes[1],
        boundingBox: {
          topLeft: [1, 10, 3],
          width: 9,
          height: 10,
          depth: 27,
        },
      },
      actionTracingId: "skeletonTracing1",
    });

    expect(updateVisibilityForSecond.name).toBe("updateUserBoundingBoxVisibilityInSkeletonTracing");
    expect(updateVisibilityForSecond.value).toEqual({
      boundingBoxId: 2,
      actionTracingId: "skeletonTracing1",
      isVisible: false,
    });

    expect(changeSecond.name).toBe("updateUserBoundingBoxInSkeletonTracing");
    expect(changeSecond.value).toEqual({
      boundingBoxId: 2,
      actionTracingId: "skeletonTracing1",
      color: [1, 1, 1],
      boundingBox: {
        topLeft: [1, 5, 3],
        width: 9,
        height: 15,
        depth: 27,
      },
    });
  });

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
