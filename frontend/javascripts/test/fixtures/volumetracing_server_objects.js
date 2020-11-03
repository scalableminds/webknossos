// @flow
import type { ServerVolumeTracing, APIAnnotation } from "types/api_flow_types";

export const tracing: ServerVolumeTracing = {
  activeSegmentId: 10000,
  boundingBox: { topLeft: { x: 0, y: 0, z: 0 }, width: 1024, height: 1024, depth: 1024 },
  userBoundingBoxes: [],
  createdTimestamp: 1529066010230,
  dataSetName: "ROI2017_wkw",
  editPosition: { x: 3904, y: 4282, z: 2496 },
  editRotation: { x: 0, y: 0, z: 0 },
  elementClass: "uint16",
  id: "segmentation",
  largestSegmentId: 21890,
  version: 0,
  zoomLevel: 0,
};

export const annotation: APIAnnotation = {
  description: "",
  state: "Active",
  id: "598b52293c00009906f043e7",
  visibility: "Internal",
  modified: 1529066010230,
  name: "",
  typ: "Explorational",
  task: null,
  stats: {},
  restrictions: { allowAccess: true, allowUpdate: true, allowFinish: true, allowDownload: true },
  formattedHash: "f043e7",
  tracing: { skeleton: null, volume: "segmentation" },
  dataSetName: "ROI2017_wkw",
  organization: "Connectomics Department",
  dataStore: {
    name: "localhost",
    url: "http://localhost:9000",
    isScratch: false,
    isForeign: false,
    isConnector: false,
    allowsUpload: true,
  },
  tracingStore: { name: "localhost", url: "http://localhost:9000" },
  settings: {
    allowedModes: ["volume"],
    branchPointsAllowed: true,
    somaClickingAllowed: true,
  },
  tags: ["ROI2017_wkw", "volume"],
  tracingTime: 0,
  meshes: [],
};
