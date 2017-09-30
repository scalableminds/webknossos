db.runCommand({
  collMod: "tasks",
  validator: {
    $and: [
      {
        _taskType: { $type: "objectId", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        neededExperience: { $type: "object", $exists: true },
      },
      {
        "neededExperience.domain": { $regex: "^.{3,}$", $exists: true },
      },
      {
        "neededExperience.value": { $type: "number", $exists: true },
      },
      {
        instances: { $type: "number", $exists: true },
      },
      {
        $or: [{ tracingTime: { $type: "number" } }, { tracingTime: { $exists: false } }],
      },
      {
        created: { $type: "number", $exists: true },
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        _project: { $type: "string", $exists: true },
      },
      {
        $or: [
          { _script: { $type: "string" } },
          { _script: { $exists: false } },
          { _script: { $type: "null" } },
        ], //1000 x script null - maybe replace
      },
      {
        $or: [{ creationInfo: { $type: "string" } }, { creationInfo: { $exists: false } }], //TODO
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
