db.runCommand({
  collMod: "skeletons",
  validator: {
    $and: [
      {
        dataSetName: { $type: "string", $exists: true },
      },
      {
        timestamp: { $type: "number", $exists: true },
      },
      {
        $or: [{ activeNodeId: { $type: "number" } }, { activeNodeId: { $exists: false } }],
      },
      {
        editPosition: { $type: "number", $exists: true },
      },
      {
        editRotation: { $type: "number", $exists: true },
      },
      {
        zoomLevel: { $type: "number", $exists: true },
      },
      {
        $or: [
          {
            $and: [
              { boundingBox: { $type: "object" } },
              { "boundingBox.topLeft": { $type: "number", $exists: true } },
              { "boundingBox.width": { $type: "number", $exists: true } },
              { "boundingBox.height": { $type: "number", $exists: true } },
              { "boundingBox.depth": { $type: "number", $exists: true } },
            ],
          },
          { boundingBox: { $exists: false } },
          { boundingBox: { $type: "null" } }, // boundingBox null - maybe replace
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
  validationAction: "warn",
  validationLevel: "strict",
});
//no errors