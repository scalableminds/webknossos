db.runCommand({
  collMod: "volumes",
  validator: {
    $and: [
      {
        dataSetName: { $type: "string", $exists: true },
      },
      {
        dataStoreContent: { $type: "object", $exists: true },
      },
      {
        $or: [{ activeCellId: { $type: "number" } }, { activeCellId: { $exists: false } }],
      },
      {
        timestamp: { $type: "number", $exists: true },
      },
      {
        editPosition: { $type: "array", $exists: true },
      },
      {
        editRotation: { $type: "array", $exists: true },
      },
      {
        zoomLevel: { $type: "number", $exists: true },
      },
      {
        nextCellId: { $type: "number", $exists: true },
      },
      {
        $or: [{ activeCellId: { $type: "number" } }, { activeCellId: { $exists: false } }],
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
