db.runCommand({
  collMod: "edges",
  validator: {
    $and: [
      {
        edge: { $type: "object", $exists: true },
      },
      {
        _treeId: { $type: "objectId", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
