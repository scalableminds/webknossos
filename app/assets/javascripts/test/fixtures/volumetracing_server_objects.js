// @flow
import type { ServerVolumeTracingType, APIAnnotationType } from "admin/api_flow_types";

export const tracing: ServerVolumeTracingType = {
  activeSegmentId: 10000,
  boundingBox: { topLeft: { x: 0, y: 0, z: 0 }, width: 1024, height: 1024, depth: 1024 },
  createdTimestamp: 1529066010230,
  editPosition: { x: 3904, y: 4282, z: 2496 },
  editRotation: { x: 0, y: 0, z: 0 },
  elementClass: "uint16",
  id: "segmentation",
  largestSegmentId: 21890,
  version: 0,
  zoomLevel: 0,
};

export const annotation: APIAnnotationType = {
  created: "2017-08-09 20:19",
  description: "",
  state: "Active",
  id: "598b52293c00009906f043e7",
  isPublic: false,
  modified: "2018-06-12 15:59",
  name: "",
  typ: "Explorational",
  task: null,
  stats: {},
  restrictions: { allowAccess: true, allowUpdate: true, allowFinish: true, allowDownload: true },
  formattedHash: "f043e7",
  content: { id: "segmentation", typ: "volume" },
  dataSetName: "ROI2017_wkw",
  dataStore: { name: "localhost", url: "http://localhost:9000", typ: "webknossos-store" },
  settings: {
    allowedModes: ["volume"],
    branchPointsAllowed: true,
    somaClickingAllowed: true,
  },
  tags: ["ROI2017_wkw", "volume"],
  tracingTime: 0,
};
