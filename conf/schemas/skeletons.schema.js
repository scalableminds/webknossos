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
        editPosition: { $type: "array", $exists: true },
      },
      {
        editRotation: { $type: "array", $exists: true },
      },
      {
        zoomLevel: { $type: "double", $exists: true },
      },
      {
        $or: [{ boundingBox: { $type: "object" } }, { boundingBox: { $exists: false } }],
      },
      {
        $or: [{ stats: { $type: "object" } }, { stats: { $exists: false } }],
      },
      {
        settings: { $type: "object", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
