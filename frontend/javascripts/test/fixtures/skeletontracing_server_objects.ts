import type { ServerSkeletonTracing, APIAnnotation } from "types/api_flow_types";
export const tracing: ServerSkeletonTracing = {
  typ: "Skeleton",
  id: "47e37793-d0be-4240-a371-87ce68561a13",
  trees: [
    {
      treeId: 2,
      createdTimestamp: 1528981227174,
      nodes: [
        {
          id: 3,
          position: {
            x: 138,
            y: 22,
            z: 0,
          },
          additionalCoordinates: [],
          rotation: {
            x: 0,
            y: 0,
            z: 0,
          },
          radius: 112.39999389648438,
          viewport: 0,
          resolution: 1,
          bitDepth: 4,
          interpolation: true,
          createdTimestamp: 1502302785450,
        },
      ],
      edges: [],
      color: {
        r: 0,
        g: 0,
        b: 1,
        a: 1,
      },
      branchPoints: [
        {
          nodeId: 3,
          createdTimestamp: 1502302770510,
        },
      ],
      comments: [
        {
          nodeId: 3,
          content: "Test",
        },
      ],
      name: "explorative_2017-08-09_SCM_Boy_002",
      isVisible: true,
    },
    {
      treeId: 1,
      createdTimestamp: 1528981227574,
      nodes: [
        {
          id: 1,
          position: {
            x: 24,
            y: 32,
            z: 0,
          },
          additionalCoordinates: [],
          rotation: {
            x: 0,
            y: 0,
            z: 0,
          },
          radius: 112.39999389648438,
          viewport: 0,
          resolution: 1,
          bitDepth: 4,
          interpolation: true,
          createdTimestamp: 1502302785447,
        },
        {
          id: 2,
          position: {
            x: 104,
            y: 106,
            z: 0,
          },
          additionalCoordinates: [],
          rotation: {
            x: 0,
            y: 0,
            z: 0,
          },
          radius: 112.39999389648438,
          viewport: 0,
          resolution: 1,
          bitDepth: 4,
          interpolation: true,
          createdTimestamp: 1502302785448,
        },
      ],
      edges: [
        {
          source: 1,
          target: 2,
        },
      ],
      color: {
        r: 0.6784313917160034,
        g: 0.1411764770746231,
        b: 0.05098039284348488,
        a: 1.0,
      },
      branchPoints: [
        {
          nodeId: 1,
          createdTimestamp: 1502302774534,
        },
      ],
      comments: [],
      isVisible: true,
      name: "explorative_2017-08-09_SCM_Boy_001",
    },
  ],
  treeGroups: [
    {
      children: [],
      name: "Group 1",
      groupId: 1,
    },
    {
      children: [
        {
          children: [],
          name: "Group 3",
          groupId: 3,
        },
      ],
      name: "Group 2",
      groupId: 2,
    },
  ],
  createdTimestamp: 1502302761387,
  userBoundingBoxes: [],
  activeNodeId: 3,
  editPosition: {
    x: 24,
    y: 32,
    z: 0,
  },
  editPositionAdditionalCoordinates: null,
  editRotation: {
    x: 79.99999570976581,
    y: 73.99999869555745,
    z: 4.908922051072295e-7,
  },
  additionalAxes: [],
  zoomLevel: 2,
  version: 7,
};
export const annotation: APIAnnotation = {
  description: "",
  state: "Active",
  id: "598b52293c00009906f043e7",
  visibility: "Internal",
  modified: 1529066010230,
  name: "",
  teams: [],
  typ: "Explorational",
  task: null,
  restrictions: {
    allowAccess: true,
    allowUpdate: true,
    allowFinish: true,
    allowDownload: true,
    allowSave: true,
  },
  annotationLayers: [
    {
      name: "Skeleton",
      tracingId: "47e37793-d0be-4240-a371-87ce68561a13",
      typ: "Skeleton",
      stats: {},
    },
  ],
  dataSetName: "ROI2017_wkw",
  organization: "Connectomics Department",
  dataStore: {
    name: "localhost",
    url: "http://localhost:9000",
    isScratch: false,
    allowsUpload: true,
    jobsEnabled: false,
    jobsSupportedByAvailableWorkers: [],
  },
  tracingStore: {
    name: "localhost",
    url: "http://localhost:9000",
  },
  settings: {
    allowedModes: ["orthogonal", "oblique", "flight"],
    branchPointsAllowed: true,
    somaClickingAllowed: true,
    volumeInterpolationAllowed: false,
    mergerMode: false,
    resolutionRestrictions: {},
  },
  tags: ["ROI2017_wkw", "skeleton"],
  tracingTime: 0,
  contributors: [],
  othersMayEdit: false,
};
