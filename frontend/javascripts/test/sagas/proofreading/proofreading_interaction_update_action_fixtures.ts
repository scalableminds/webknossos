import { SKELETON_TRACING_ID } from "test/fixtures/skeletontracing_server_objects";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import type { Vector3 } from "viewer/constants";

export const loadAgglomerateTree1 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 1,
        anchorPosition: [1, 1, 1] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 3,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [1, 1, 1] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 5,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [2, 2, 2] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 6,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [3, 3, 3] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
];

export const mergeSegment4And6WithAgglomerateTree1And4 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 5,
        anchorPosition: [5, 5, 5] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
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
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 4,
        agglomerateId2: 6,
        segmentId1: 5,
        segmentId2: 6,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 4,
        anchorPosition: [5, 5, 5] as Vector3,
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
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [6, 6, 6] as Vector3,
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
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [7, 7, 7] as Vector3,
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
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 3,
        anchorPosition: [3, 3, 3] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
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
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 1,
        agglomerateId2: 4,
        segmentId1: 3,
        segmentId2: 4,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [3, 3, 3] as Vector3,
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

export const mergeSegment1And4 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        additionalCoordinates: undefined,
        anchorPosition: [1, 1, 1] as Vector3,
        color: null,
        creationTime: 1494695001688,
        groupId: null,
        id: 1,
        metadata: [],
        name: null,
      },
    },
  ],
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 1,
        segmentId2: 4,
        agglomerateId1: 1,
        agglomerateId2: 4,
      },
    },
  ],
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 1,
        agglomerateId2: 4,
        segmentId1: 1,
        segmentId2: 4,
      },
    },
  ],
];

export const mergeSegment1And4WithAgglomerateTrees1And4And6 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 1,
        anchorPosition: [1, 1, 1] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 1,
        segmentId2: 4,
        agglomerateId1: 1,
        agglomerateId2: 4,
      },
    },
  ],
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 1,
        agglomerateId2: 4,
        segmentId1: 1,
        segmentId2: 4,
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
        source: 4,
        target: 7,
      },
    },
  ],
];

export const mergeSegment3And4WithAgglomerateTree1 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 3,
        anchorPosition: [3, 3, 3] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
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
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 1,
        agglomerateId2: 4,
        segmentId1: 3,
        segmentId2: 4,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [3, 3, 3] as Vector3,
      },
    },
  ],
  [
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 7,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [4, 4, 4] as Vector3,
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
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [5, 5, 5] as Vector3,
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
  ],
];

export const mergeSegment5And6 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        additionalCoordinates: undefined,
        anchorPosition: [5, 5, 5] as Vector3,
        color: null,
        creationTime: 1494695001688,
        groupId: null,
        id: 4,
        metadata: [],
        name: null,
      },
    },
  ],
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
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 4,
        agglomerateId2: 6,
        segmentId1: 5,
        segmentId2: 6,
      },
    },
  ],
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
    },
  ],
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 4,
        agglomerateId2: 6,
        segmentId1: 5,
        segmentId2: 6,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 4,
        anchorPosition: [5, 5, 5] as Vector3,
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
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [6, 6, 6] as Vector3,
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
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [7, 7, 7] as Vector3,
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
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 4,
        agglomerateId2: 6,
        segmentId1: 5,
        segmentId2: 6,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 4,
        anchorPosition: [5, 5, 5] as Vector3,
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
  ],
  [
    {
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 1,
        agglomerateId2: 6,
        segmentId1: 3,
        segmentId2: 6,
      },
    },
  ],
  [
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 7,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [6, 6, 6] as Vector3,
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
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [7, 7, 7] as Vector3,
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
  ],
];

export const splitSegment2And3 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        additionalCoordinates: undefined,
        anchorPosition: [2, 2, 2] as Vector3,
        color: null,
        creationTime: 1494695001688,
        groupId: null,
        id: 1,
        metadata: [],
        name: null,
      },
    },
  ],
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 3,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [2, 2, 2] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [3, 3, 3] as Vector3,
      },
    },
  ],
];

export const splitSegment2And3WithAgglomerateTree1 = [
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 3,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [2, 2, 2] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [3, 3, 3] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 3,
        targetId: 4,
        nodeIds: [4, 5],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
];

export const splitSegment1And2 = [
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 1,
        anchorPosition: [1, 1, 1] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
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
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: "volumeTracingId",
        id: 1339,
        anchorPosition: [2, 2, 2] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
];

export const splitSegment1And2WithAgglomerateTree1 = [
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 1,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [2, 2, 2] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 3,
        targetId: 4,
        nodeIds: [5, 6],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
  ],
];

// Differs in tree ids compared to splitSegment1And2WithAgglomerateTree1 above.
export const splitSegment1And2WithAgglomerateTrees1And6And4 = [
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 1,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [2, 2, 2] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 6,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 3,
        targetId: 6,
        nodeIds: [5, 6],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
  ],
];

// Does not differ from splitSegment1And2WithAgglomerateTrees1And6And4 as both have the same three agglomerate trees loaded
// and only agglomerate 1 is affected by the split. As it is the first loaded agglomerate tree, the actions and their ids are equal.
export const splitSegment1And2WithAgglomerateTrees1And4And6 =
  splitSegment1And2WithAgglomerateTrees1And6And4;

export const splitSegment2And3WithAgglomerateTrees1And4And6 = [
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 1,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 2,
        segmentId2: 3,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [2, 2, 2] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [3, 3, 3] as Vector3,
        additionalCoordinates: undefined,
        name: null,
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 6,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 3,
        targetId: 6,
        nodeIds: [4, 6, 7, 8],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
];

export const minCutWithNodes2And3WithAgglomerateTree1 = [
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        updatedId: undefined,
        color: [0, 1, 0.7568627450980392] as Vector3,
        name: "agglomerate 1 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 3,
        targetId: 4,
        nodeIds: [6],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 3,
        segmentId2: 2,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "updateTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 3,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: undefined,
        additionalCoordinates: undefined,
        name: "Agglomerate 1339",
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [3, 3, 3] as Vector3,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [2, 2, 2] as Vector3,
      },
    },
  ],
];

export const mergeAgglomerateTrees1And4 = [
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 3,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [1, 1, 1] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 5,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [2, 2, 2] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 6,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [3, 3, 3] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 4 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 4,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 7,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [4, 4, 4] as Vector3,
        treeId: 4,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 8,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [5, 5, 5] as Vector3,
        treeId: 4,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 4,
        source: 7,
        target: 8,
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
    {
      name: "updateActiveNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        activeNode: 6,
      },
    },
  ],
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
      name: "mergeSegmentItems" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        agglomerateId1: 1,
        agglomerateId2: 4,
        segmentId1: 3,
        segmentId2: 4,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [3, 3, 3] as Vector3,
      },
    },
  ],
];

export const splitAgglomerateTree1 = [
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 3,
        updatedId: undefined,
        color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744] as Vector3,
        name: "agglomerate 1 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [1, 1, 1] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 5,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [2, 2, 2] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createNode" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 6,
        additionalCoordinates: [],
        rotation: [0, 0, 0] as Vector3,
        bitDepth: 8,
        viewport: 0,
        radius: 1,
        timestamp: 1494695001688,
        interpolation: false,
        position: [3, 3, 3] as Vector3,
        treeId: 3,
        resolution: 1,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 4,
        target: 5,
      },
    },
    {
      name: "createEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
  [
    {
      name: "createTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        updatedId: undefined,
        color: [0, 1, 0.7568627450980392] as Vector3,
        name: "agglomerate 1 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
    {
      name: "moveTreeComponent" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        sourceId: 3,
        targetId: 4,
        nodeIds: [6],
      },
    },
    {
      name: "deleteEdge" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        treeId: 3,
        source: 5,
        target: 6,
      },
    },
  ],
  [
    {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        segmentId1: 2,
        segmentId2: 3,
        agglomerateId: 1,
      },
    },
  ],
  [
    {
      name: "updateTree" as const,
      value: {
        actionTracingId: SKELETON_TRACING_ID,
        id: 4,
        updatedId: undefined,
        color: [0, 1, 0.7568627450980392] as Vector3,
        name: "agglomerate 1339 (volumeTracingId)",
        timestamp: 1494695001688,
        comments: [],
        branchPoints: [],
        groupId: undefined,
        isVisible: true,
        type: "AGGLOMERATE" as const,
        edgesAreVisible: true,
        metadata: [],
        agglomerateInfo: {
          agglomerateId: 1339,
          tracingId: VOLUME_TRACING_ID,
        },
      },
    },
  ],
  [
    {
      name: "createSegment" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: undefined,
        additionalCoordinates: undefined,
        name: "Agglomerate 1339",
        color: null,
        groupId: null,
        metadata: [],
        creationTime: 1494695001688,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1,
        anchorPosition: [2, 2, 2] as Vector3,
      },
    },
  ],
  [
    {
      name: "updateSegmentPartial" as const,
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        id: 1339,
        anchorPosition: [3, 3, 3] as Vector3,
      },
    },
  ],
];
