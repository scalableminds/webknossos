export default {
  version: 3,
  user: {
    id: "573f27ef3e00005400e69659",
    email: "scmboy@scalableminds.com",
    firstName: "SCM",
    lastName: "Boy",
    isAnonymous: false,
    teams: [
      {
        team: "another",
        role: {
          name: "admin",
        },
      },
    ],
  },
  created: "2017-05-03 15:17",
  stateLabel: "In Progress",
  state: {
    isAssigned: true,
    isFinished: false,
    isInProgress: true,
  },
  id: "5909d8793e00008c029d4d2a",
  name: "",
  typ: "Explorational",
  task: null,
  stats: null,
  restrictions: {
    allowAccess: true,
    allowUpdate: true,
    allowFinish: true,
    allowDownload: true,
  },
  formattedHash: "9d4d2a",
  downloadUrl: "http://localhost:9000/annotations/Explorational/5909d8793e00008c029d4d2a/download",
  content: {
    settings: {
      allowedModes: ["volume"],
      branchPointsAllowed: true,
      somaClickingAllowed: true,
      advancedOptionsAllowed: true,
    },
    dataSet: {
      name: "2012-09-28_ex145_07x2",
      dataStore: {
        name: "localhost",
        url: "http://localhost:9000",
        typ: "webknossos-store",
      },
      scale: [16.5, 16.5, 25],
      dataLayers: [
        {
          name: "color",
          category: "color",
          boundingBox: {
            topLeft: [
              3840,
              4220,
              2304,
            ],
            width: 128,
            height: 131,
            depth: 384,
          },
          resolutions: [1, 2, 4, 8],
          fallback: null,
          elementClass: "uint8",
          mappings: [],
        },
        {
          name: "segmentation",
          category: "segmentation",
          boundingBox: {
            topLeft: [
              3840,
              4220,
              2304,
            ],
            width: 128,
            height: 131,
            depth: 384,
          },
          resolutions: [1],
          fallback: null,
          elementClass: "uint16",
          mappings: [],
        },
      ],
    },
    contentData: {
      activeCell: 10000,
      customLayers: [
        {
          name: "64007765-cef9-4e31-b206-dba795b5be17",
          category: "segmentation",
          boundingBox: {
            topLeft: [
              3840,
              4220,
              2304,
            ],
            width: 128,
            height: 131,
            depth: 384,
          },
          resolutions: [1],
          fallback: {
            dataSourceName: "2012-09-28_ex145_07x2",
            layerName: "segmentation",
          },
          elementClass: "uint16",
          mappings: [
            {
              name: "mapping_1",
              path: "mapping_path",
            },
          ],
        },
      ],
      nextCell: 21890,
      zoomLevel: 0,
    },
    editPosition: [3904, 4282, 2496],
    editRotation: [0, 0, 0],
    boundingBox: null,
    contentType: "volumeTracing",
  },
  contentType: "volumeTracing",
  dataSetName: "2012-09-28_ex145_07x2",
  tracingTime: 76252,
};
