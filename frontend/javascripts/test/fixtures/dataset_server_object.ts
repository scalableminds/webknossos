import { UnitLong } from "viewer/constants";
import type { APIColorLayer, APIDataset, APISegmentationLayer } from "types/api_types";

const sampleColorLayer: APIColorLayer = {
  name: "color",
  category: "color",
  boundingBox: {
    topLeft: [0, 0, 0],
    width: 10240,
    height: 10240,
    depth: 10240,
  },
  mags: [
    { mag: [1, 1, 1] },
    { mag: [2, 2, 2] },
    { mag: [32, 32, 32] }, // unsorted on purpose
    { mag: [4, 4, 4] },
    { mag: [8, 8, 8] },
    { mag: [16, 16, 16] },
  ],
  elementClass: "uint8",
  additionalAxes: [],
};

export const sampleHdf5AgglomerateName = "sampleHdf5Mapping";
// this is a uint32 segmentation layer
const sampleSegmentationLayer: APISegmentationLayer = {
  name: "segmentation",
  category: "segmentation",
  boundingBox: {
    topLeft: [0, 0, 0],
    width: 10240,
    height: 10240,
    depth: 10240,
  },
  mags: [
    { mag: [1, 1, 1] },
    { mag: [2, 2, 2] },
    { mag: [32, 32, 32] }, // unsorted on purpose
    { mag: [4, 4, 4] },
    { mag: [8, 8, 8] },
    { mag: [16, 16, 16] },
  ],
  elementClass: "uint32",
  largestSegmentId: 1000000000,
  mappings: [
    "larger5um1",
    "axons",
    "astrocyte-ge-7",
    "astrocyte",
    "mitochondria",
    "astrocyte-full",
  ],
  agglomerates: [sampleHdf5AgglomerateName],
  tracingId: undefined,
  additionalAxes: [],
};

// This is a segmentation layer object that could be directly
// inserted into the store. Do not use this object if it's intended
// to go through the normal model initialization because it does not
// have a fallback property.
export const sampleTracingLayer: APISegmentationLayer = {
  ...sampleSegmentationLayer,
  name: "volumeTracingId",
  tracingId: "volumeTracingId",
};

function createDataset(dataLayers: Array<APIColorLayer | APISegmentationLayer>): APIDataset {
  return {
    id: "66f3c82966010034942e9740",
    name: "ROI2017_wkw",
    dataSource: {
      id: {
        name: "ROI2017_wkw",
        team: "Connectomics department",
      },
      dataLayers,
      scale: { factor: [11.239999771118164, 11.239999771118164, 28], unit: UnitLong.nm },
    },
    dataStore: {
      name: "localhost",
      url: "http://localhost:9000",
      allowsUpload: true,
      jobsSupportedByAvailableWorkers: [],
      jobsEnabled: false,
    },
    owningOrganization: "Connectomics department",
    allowedTeams: [
      {
        id: "5b1e45f9a00000a000abc2c3",
        name: "Connectomics department",
        isOrganizationTeam: true,
        organization: "Connectomics department",
      },
    ],
    allowedTeamsCumulative: [
      {
        id: "5b1e45f9a00000a000abc2c3",
        name: "Connectomics department",
        isOrganizationTeam: true,
        organization: "Connectomics department",
      },
    ],
    isActive: true,
    isPublic: false,
    description: null,
    created: 1502288550432,
    isEditable: true,
    directoryName: "ROI2017_wkw",
    isUnreported: false,
    tags: [],
    folderId: "66f3c82466010002752e972c",
    metadata: [],
    logoUrl: "/assets/images/logo.svg",
    lastUsedByUser: 1727268949322,
    sortingKey: 1727252521746,
    publication: null,
    usedStorageBytes: 0,
  };
}

const apiDataset = createDataset([sampleColorLayer, sampleSegmentationLayer]);

export const apiDatasetForVolumeTracing = createDataset([sampleSegmentationLayer]);

export default apiDataset;
