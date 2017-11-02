db.runCommand({
  collMod: "projects",
  validator: {
    $and: [
      {
        name: { $regex: "^.{3,}$", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        _owner: { $type: "objectId", $exists: true },
      },
      {
        priority: { $type: "number", $exists: true },
      },
      {
        paused: { $type: "bool", $exists: true },
      },
      {
        $or: [{ expectedTime: { $type: "number" } }, { expectedTime: { $exists: false } }],
      },
      {
        assignmentConfiguration: { $type: "object", $exists: true },
      },
      { "assignmentConfiguration.location": { $in: ["webknossos", "mturk"], $exists: true } },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
