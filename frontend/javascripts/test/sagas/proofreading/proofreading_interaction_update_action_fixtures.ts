import { SKELETON_TRACING_ID } from "test/fixtures/skeletontracing_server_objects";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";

export const loadAgglomerateTree1 = [
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        id: 3,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744],
        name: "agglomerate 1 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE",
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1,
          tracingId: "volumeTracingId",
        },
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        id: 4,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [1, 1, 1],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        id: 5,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [2, 2, 2],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        id: 6,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [3, 3, 3],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
];

export const mergeSegment4And6WithAgglomerateTree1And4 = [
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    },
  ],
  [
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 9,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [6, 6, 6],
        treeId: 4,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 10,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [7, 7, 7],
        treeId: 4,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 4,
        source: 8,
        target: 9,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 4,
        source: 9,
        target: 10,
      },
    },
  ],
];

export const mergeSegment3And4WithAgglomerateTree1And4 = [
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 3,
        segmentId2: 4,
        agglomerateId1: 1,
        agglomerateId2: 4,
      },
    },
  ],
  [
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 4,
        targetId: 3,
        nodeIds: [7, 8],
      },
    },
    {
      name: "deleteTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 6,
        target: 7,
      },
    },
  ],
];

export const mergeSegment3And4WithAgglomerateTree1 = [
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 3,
        segmentId2: 4,
        agglomerateId1: 1,
        agglomerateId2: 4,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
  [
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 7,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [4, 4, 4],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 8,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [5, 5, 5],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 6,
        target: 7,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 7,
        target: 8,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
];

export const mergeSegment5And6WithAgglomerateTree1And4 = [
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    } as UpdateActionWithoutIsolationRequirement,
  ],
  [
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 9,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [6, 6, 6],
        treeId: 4,
        resolution: 1,
      },
    } as UpdateActionWithoutIsolationRequirement,
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 10,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [7, 7, 7],
        treeId: 4,
        resolution: 1,
      },
    } as UpdateActionWithoutIsolationRequirement,
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 4,
        source: 8,
        target: 9,
      },
    } as UpdateActionWithoutIsolationRequirement,
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 4,
        source: 9,
        target: 10,
      },
    } as UpdateActionWithoutIsolationRequirement,
  ],
];

export const mergeSegment5And6WithAgglomerateTree1 = [
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    },
  ],
];

export const mergeSegment3And6WithAgglomerateTree1 = [
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 3,
        segmentId2: 6,
        agglomerateId1: 1,
        agglomerateId2: 6,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
  [
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 7,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [6, 6, 6],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 8,
        additionalCoordinates: [],
        rotation: [0, 0, 0],
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [7, 7, 7],
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 6,
        target: 7,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 7,
        target: 8,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
];

export const splitSegment2And3WithAgglomerateTree1 = [
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 3,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        id: 4,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744],
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE",
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: "volumeTracingId",
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        sourceId: 3,
        targetId: 4,
        nodeIds: [4, 5],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
];

export const splitSegment1And2WithAgglomerateTree1 = [
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 1,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        id: 4,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744],
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE",
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: "volumeTracingId",
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        sourceId: 3,
        targetId: 4,
        nodeIds: [5, 6],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
  ] as UpdateActionWithoutIsolationRequirement[],
];
