db.runCommand({
  collMod: "openAssignments",
  validator: {
    $and: [
      {
        instances: { $type: "int", $exists: true },
      },
      {
        _task: { $type: "objectId", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        _project: { $type: "string", $exists: true },
      },
      {
        neededExperience: { $type: "object", $exists: true },
      },
      {
        "neededExperience.domain": { $regex: "^[A-Za-z0-9-_]+$", $exists: true },
      },
      {
        "neededExperience.value": { $type: "int", $exists: true },
      },
      {
        priority: { $type: "int", $exists: true },
      },
      {
        created: { $type: "long", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
