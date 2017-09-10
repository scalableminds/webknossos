db.runCommand({
  collMod: "nodes",
  validator: {
    $and: [
      {
        node: { $type: "object", $exists: true },
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
