db.runCommand({
  collMod: "taskTypes",
  validator: {
    $and: [
      {
        summary: { $type: "string", $exists: true },
      },
      {
        description: { $type: "string", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        settings: { $type: "object", $exists: true },
      },
      {
        $or: [{ fileName: { $type: "string" } }, { fileName: { $exists: false } }],
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
