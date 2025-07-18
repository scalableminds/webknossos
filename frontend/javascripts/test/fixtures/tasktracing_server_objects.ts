import {
  type ServerSkeletonTracing,
  type APIAnnotation,
  AnnotationLayerEnum,
  type APITracingStoreAnnotation,
} from "types/api_types";
import { ViewModeValues } from "viewer/constants";

const TRACING_ID = "skeletonTracingId-e90133de-b2db-4912-8261-8b6f84f7edab";
export const tracing: ServerSkeletonTracing = {
  typ: "Skeleton",
  trees: [
    {
      nodes: [
        {
          id: 1,
          position: {
            x: 0,
            y: 0,
            z: 0,
          },
          additionalCoordinates: [],
          rotation: {
            x: 0,
            y: 0,
            z: 0,
          },
          radius: 120,
          viewport: 1,
          mag: 1,
          bitDepth: 0,
          interpolation: false,
          createdTimestamp: 1528811979356,
        },
      ],
      edges: [],
      branchPoints: [],
      comments: [],
      treeId: 1,
      color: {
        r: 1,
        g: 0,
        b: 0,
        a: 1,
      },
      name: "", // there is a test that asserts that empty names will be renamed automatically
      isVisible: true,
      createdTimestamp: 1528811979356,
      metadata: [],
    },
  ],
  treeGroups: [],
  createdTimestamp: 1528811983951,
  userBoundingBoxes: [],
  additionalAxes: [],
  userStates: [],
  editPosition: {
    x: 0,
    y: 0,
    z: 0,
  },
  editPositionAdditionalCoordinates: null,
  editRotation: {
    x: 0,
    y: 0,
    z: 0,
  },
  zoomLevel: 2,
  id: TRACING_ID,
};
export const annotation: APIAnnotation = {
  datasetId: "datasetId-66f3c82966010034942e9740",
  modified: 1529066010230,
  state: "Active",
  id: "annotationId-5b1fd1cf97000027049c67ee",
  name: "",
  description: "",
  stats: {},
  typ: "Task",
  task: {
    id: "taskId-5b1fd1cb97000027049c67ec",
    projectName: "sampleProject",
    projectId: "dummy-project-id",
    team: "Connectomics department",
    type: {
      id: "5b1e45faa000009d00abc2c6",
      summary: "sampleTaskType",
      description: "Description",
      teamId: "teamId-5b1e45f9a00000a000abc2c3",
      teamName: "Connectomics department",
      settings: {
        allowedModes: ViewModeValues,
        branchPointsAllowed: true,
        somaClickingAllowed: true,
        volumeInterpolationAllowed: false,
        mergerMode: false,
        magRestrictions: {},
      },
      recommendedConfiguration: null,
      tracingType: "skeleton",
    },
    datasetId: "datasetId-66f3c82966010034942e9740",
    datasetName: "ROI2017_wkw",
    neededExperience: {
      domain: "oxalis",
      value: 1,
    },
    created: 1529066010230,
    status: {
      pending: 0,
      active: 1,
      finished: 0,
    },
    script: null,
    tracingTime: null,
    creationInfo: null,
    boundingBox: null,
    editPosition: [0, 0, 0],
    editRotation: [0, 0, 0],
  },
  restrictions: {
    allowAccess: true,
    allowUpdate: true,
    allowFinish: true,
    allowDownload: true,
  },
  annotationLayers: [
    {
      name: "Skeleton",
      tracingId: TRACING_ID,
      typ: AnnotationLayerEnum.Skeleton,
      stats: {},
    },
  ],
  dataSetName: "ROI2017_wkw",
  organization: "Connectomics Department",
  dataStore: {
    name: "localhost",
    url: "http://localhost:9000",
    allowsUpload: true,
    jobsEnabled: false,
    jobsSupportedByAvailableWorkers: [],
  },
  tracingStore: {
    name: "localhost",
    url: "http://localhost:9000",
  },
  visibility: "Internal",
  settings: {
    allowedModes: ViewModeValues,
    branchPointsAllowed: true,
    somaClickingAllowed: true,
    volumeInterpolationAllowed: false,
    mergerMode: false,
    magRestrictions: {},
  },
  tracingTime: null,
  tags: ["ROI2017_wkw", "skeleton"],
  owner: {
    id: "userId-5b1e45faa00000a900abc2c5",
    email: "sample@scm.io",
    firstName: "Sample",
    lastName: "User",
    isAnonymous: false,
    isAdmin: true,
    isDatasetManager: true,
    teams: [
      {
        id: "teamId-5b1e45f9a00000a000abc2c3",
        name: "Connectomics department",
        isTeamManager: true,
      },
    ],
  },
  contributors: [],
  othersMayEdit: false,
  isLockedByOwner: false,
  teams: [
    {
      id: "teamId-5b1e45f9a00000a000abc2c3",
      name: "Connectomics department",
      organization: "Connectomics department",
    },
  ],
};
export const annotationProto: APITracingStoreAnnotation = {
  description: "task-annotation-description",
  version: 1,
  earliestAccessibleVersion: 0,
  annotationLayers: [
    {
      tracingId: TRACING_ID,
      name: "Skeleton",
      typ: AnnotationLayerEnum.Skeleton,
    },
  ],
  userStates: [],
};
