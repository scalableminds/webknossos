// @noflow
export default {
  name: "ROI2017_wkw",
  dataSource: {
    id: { name: "ROI2017_wkw", team: "Connectomics department" },
    dataLayers: [
      {
        name: "color",
        category: "color",
        boundingBox: { topLeft: [0, 0, 0], width: 10240, height: 10240, depth: 10240 },
        resolutions: [[1, 1, 1], [2, 2, 2], [32, 32, 32], [4, 4, 4], [8, 8, 8], [16, 16, 16]],
        elementClass: "uint8",
      },
      {
        name: "segmentation",
        category: "segmentation",
        boundingBox: { topLeft: [0, 0, 0], width: 10240, height: 10240, depth: 10240 },
        resolutions: [[1, 1, 1], [2, 2, 2], [32, 32, 32], [4, 4, 4], [8, 8, 8], [16, 16, 16]],
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
        tracingId: null,
      },
    ],
    scale: [11.239999771118164, 11.239999771118164, 28],
  },
  dataStore: { name: "localhost", url: "http://localhost:9000", typ: "webknossos-store" },
  owningOrganization: "Connectomics department",
  allowedTeams: ["Connectomics department"],
  isActive: true,
  isPublic: false,
  description: null,
  created: 1502288550432,
  isEditable: true,
};
