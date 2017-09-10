db.runCommand({
  collMod: "projects",
  validator: {
    $and: [
      {
        name: { $type: "string", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        _owner: { $type: "objectId", $exists: true },
      },
      {
        priority: { $type: "int", $exists: true },
      },
      {
        paused: { $type: "bool", $exists: true },
      },
      {
        $or: [{ expectedTime: { $type: "int" } }, { expectedTime: { $exists: false } }],
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
