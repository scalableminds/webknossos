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
        editPosition: { $type: "double", $exists: true },
      },
      {
        editRotation: { $type: "double", $exists: true },
      },
      {
        zoomLevel: { $type: "double", $exists: true },
      },
      {
        $or: [
          {
            $and: [
              { boundingBox: { $type: "object" } },
              { "boundingBox.topLeft": { $type: "double", $exists: true } },
              { "boundingBox.width": { $type: "int", $exists: true } },
              { "boundingBox.height": { $type: "int", $exists: true } },
              { "boundingBox.depth": { $type: "int", $exists: true } },
            ],
          },
          { boundingBox: { $exists: false } },
        ],
      },
      {
        $or: [
          {
            $or: [
              {
                $and: [
                  { stats: { $type: "object" } },
                  { "stats.numberOfNodes": { $type: "number", $exists: true } },
                  { "stats.numberOfEdges": { $type: "number", $exists: true } },
                  { "stats.numberOfTrees": { $type: "number", $exists: true } },
                ],
              },
              { stats: { $exists: false } },
            ],
            $and: [
              { stats: { $type: "object" } },
              { "stats.numberOfNodes": { $type: "number", $exists: true } },
              { "stats.numberOfEdges": { $type: "number", $exists: true } },
              { "stats.numberOfTrees": { $type: "number", $exists: true } },
            ],
          },
          { stats: { $exists: false } },
        ],
      },
      {
        settings: { $type: "object", $exists: true },
      },
      {
        "settings.allowedModes": { $type: "string", $exists: true },
      },
      {
        $or: [
          { "settings.preferredMode": { $type: "string" } },
          { "settings.preferredMode": { $exists: false } },
        ],
      },
      {
        "settings.branchPointsAllowed": { $type: "bool", $exists: true },
      },
      {
        "settings.somaClickingAllowed": { $type: "bool", $exists: true },
      },
      {
        "settings.advancedOptionsAllowed": { $type: "bool", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
