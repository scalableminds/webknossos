db.runCommand({
  collMod: "projects",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true },
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
        assignmentConfiguration: {
          $type: "object",
          $exists: true,
          $elemMatch: { location: { $in: ["webknossos", "mturk"], $exists: true } },
        },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
