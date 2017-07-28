export default {
  version: 2,
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
  created: "2017-02-08 14:23",
  stateLabel: "In Progress",
  state: {
    isAssigned: true,
    isFinished: false,
    isInProgress: true,
  },
  id: "589b1bda4000009803e96ebc",
  name: "",
  typ: "Explorational",
  task: null,
  stats: {
    numberOfNodes: 3,
    numberOfEdges: 1,
    numberOfTrees: 2,
  },
  restrictions: {
    allowAccess: true,
    allowUpdate: true,
    allowFinish: true,
    allowDownload: true,
  },
  formattedHash: "e96ebc",
  downloadUrl: "http://localhost:9000/annotations/Explorational/589b1bda4000009803e96ebc/download",
  content: {
    settings: {
      allowedModes: ["orthogonal", "oblique", "flight"],
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
          mappings: [
            {
              name: "mapping_1",
              path: "mappingPath",
            },
          ],
        },
      ],
    },
    contentData: {
      activeNode: 3,
      trees: [
        {
          id: 1,
          nodes: [
            {
              id: 1,
              radius: 165,
              position: [3903, 4283, 2496],
              rotation: [0, 0, 0],
              viewport: 0,
              resolution: 0,
              bitDepth: 8,
              interpolation: false,
              timestamp: 1486560222916,
            },
            {
              id: 2,
              radius: 165,
              position: [3914, 4277, 2496],
              rotation: [0, 0, 0],
              viewport: 0,
              resolution: 0,
              bitDepth: 8,
              interpolation: false,
              timestamp: 1486560224706,
            },
          ],
          edges: [
            {
              source: 1,
              target: 2,
            },
          ],
          name: "explorative_2017-02-08_SCM_Boy_001",
          color: [0, 0.2901961, 1, 1],
          timestamp: 1486560222916,
          comments: [],
          branchPoints: [
            {
              id: 1,
              timestamp: 1486560222916,
            },
          ],
        },
        {
          id: 2,
          nodes: [
            {
              id: 3,
              radius: 165,
              position: [3918, 4292, 2496],
              rotation: [0, 0, 0],
              viewport: 0,
              resolution: 0,
              bitDepth: 8,
              interpolation: false,
              timestamp: 1486560227441,
            },
          ],
          edges: [],
          name: "explorative_2017-02-08_SCM_Boy_002",
          color: [0.5803922, 1, 0, 1],
          timestamp: 1486560227441,
          comments: [
            {
              content: "Test",
              node: 3,
            },
          ],
          branchPoints: [
            {
              id: 3,
              timestamp: 1486560227441,
            },
          ],
        },
      ],
      zoomLevel: -1.4,
    },
    editPosition: [3918, 4292, 2496],
    editRotation: [0, 0, 0],
    boundingBox: null,
    contentType: "skeletonTracing",
  },
  contentType: "skeletonTracing",
  dataSetName: "2012-09-28_ex145_07x2",
  tracingTime: 9702,
};
