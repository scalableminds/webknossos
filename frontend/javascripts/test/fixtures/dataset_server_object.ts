import { UnitLong } from "oxalis/constants";
import type { APIDataset } from "types/api_types";

const apiDataset: APIDataset = {
  id: "66f3c82966010034942e9740",
  name: "ROI2017_wkw",
  dataSource: {
    id: {
      name: "ROI2017_wkw",
      team: "Connectomics department",
    },
    dataLayers: [
      {
        name: "color",
        category: "color",
        boundingBox: {
          topLeft: [0, 0, 0],
          width: 10240,
          height: 10240,
          depth: 10240,
        },
        resolutions: [
          [1, 1, 1],
          [2, 2, 2],
          [32, 32, 32],
          [4, 4, 4],
          [8, 8, 8],
          [16, 16, 16],
        ],
        elementClass: "uint8",
        additionalAxes: [],
      },
      {
        name: "segmentation",
        category: "segmentation",
        boundingBox: {
          topLeft: [0, 0, 0],
          width: 10240,
          height: 10240,
          depth: 10240,
        },
        resolutions: [
          [1, 1, 1],
          [2, 2, 2],
          [32, 32, 32],
          [4, 4, 4],
          [8, 8, 8],
          [16, 16, 16],
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
        tracingId: undefined,
        additionalAxes: [],
      },
    ],
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
      organization: "Connectomics department",
    },
  ],
  allowedTeamsCumulative: [
    {
      id: "5b1e45f9a00000a000abc2c3",
      name: "Connectomics department",
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

export default apiDataset;
