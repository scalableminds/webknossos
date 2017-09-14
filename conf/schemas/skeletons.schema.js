db.runCommand({
  collMod: "skeletons",
  validator: {
    $and: [
      {
        dataSetName: { $type: "string", $exists: true },
      },
      {
        timestamp: { $type: "long", $exists: true },
      },
      {
        $or: [{ activeNodeId: { $type: "int" } }, { activeNodeId: { $exists: false } }],
      },
      {
        editPosition: { $type: "array", $exists: true }, //TODO
      },
      {
        editRotation: { $type: "array", $exists: true }, //TODO
      },
      {
        zoomLevel: { $type: "double", $exists: true },
      },
      {
        $or: [
          {
            boundingBox: {
              $type: "object",
              $elemMatch: {
                $and: [
                  { topLeft: { $type: "array", $exists: true } },
                  { width: { $type: "int", $exists: true } },
                  { height: { $type: "int", $exists: true } },
                  { depth: { $type: "int", $exists: true } },
                ],
              },
            },
          },
          { boundingBox: { $exists: false } },
        ],
      },
      {
        $or: [
          {
            stats: {
              $type: "object",
              $elemMatch: {
                $and: [
                  { numberOfNodes: { $type: "long", $exists: true } },
                  { numberOfEdges: { $type: "long", $exists: true } },
                  { numberOfTrees: { $type: "long", $exists: true } },
                ],
              },
            },
          },
          { stats: { $exists: false } },
        ],
      },
      {
        settings: {
          $type: "object",
          $exists: true,
          $elemMatch: {
            $and: [
              { allowedModes: { $type: "array", $exists: true } },
              {
                $or: [
                  { preferredMode: { $type: "string" } },
                  { preferredMode: { $exists: false } },
                ],
              },
              { branchPointsAllowed: { $type: "bool", $exists: true } },
              { somaClickingAllowed: { $type: "bool", $exists: true } },
              { advancedOptionsAllowed: { $type: "bool", $exists: true } },
            ],
          },
        },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
