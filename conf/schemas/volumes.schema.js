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
        $or: [{ activeCellId: { $type: "int" } }, { activeCellId: { $exists: false } }],
      },
      {
        timestamp: { $type: "long", $exists: true },
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
        nextCellId: { $type: "long", $exists: true },
      },
      {
        $or: [{ activeCellId: { $type: "int" } }, { activeCellId: { $exists: false } }],
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
