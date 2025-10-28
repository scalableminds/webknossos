import {
  type APIAnnotation,
  AnnotationLayerEnum,
  type APITracingStoreAnnotation,
} from "types/api_types";
import { tracing as skeletonTracing } from "./skeletontracing_server_objects";
import { tracing as volumeTracing } from "./volumetracing_server_objects";
import { ViewModeValues } from "viewer/constants";

const volumeTracingId2 = volumeTracing.id + "_2";
const volumeTracing2 = {
  ...volumeTracing,
  id: volumeTracingId2,
  fallbackLayer: undefined,
};
export const tracings = [skeletonTracing, volumeTracing, volumeTracing2];

export const annotation: APIAnnotation = {
  description: "",
  datasetId: "66f3c82966010034942e9740",
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
      name: AnnotationLayerEnum.Skeleton,
      tracingId: skeletonTracing.id,
      typ: AnnotationLayerEnum.Skeleton,
      stats: {},
    },
    {
      name: AnnotationLayerEnum.Volume,
      tracingId: volumeTracing.id,
      typ: AnnotationLayerEnum.Volume,
      stats: {},
    },
    {
      name: AnnotationLayerEnum.Volume,
      tracingId: volumeTracingId2,
      typ: AnnotationLayerEnum.Volume,
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
  settings: {
    allowedModes: ViewModeValues,
    branchPointsAllowed: true,
    somaClickingAllowed: true,
    volumeInterpolationAllowed: false,
    mergerMode: false,
    magRestrictions: {},
  },
  tags: ["ROI2017_wkw", "skeleton"],
  tracingTime: 0,
  contributors: [],
  othersMayEdit: false,
  isLockedByOwner: false,
};

export const annotationProto: APITracingStoreAnnotation = {
  description: "hybrid-annotation-description",
  version: 1,
  earliestAccessibleVersion: 0,
  annotationLayers: [
    {
      tracingId: skeletonTracing.id,
      name: "skeleton layer name",
      typ: AnnotationLayerEnum.Skeleton,
    },
    {
      tracingId: volumeTracing.id,
      name: "volume layer name",
      typ: AnnotationLayerEnum.Volume,
    },
    {
      tracingId: volumeTracingId2,
      name: "volume layer name 2",
      typ: AnnotationLayerEnum.Volume,
    },
  ],
  userStates: [],
};
