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
        neededExperience: {
          $type: "object",
          $exists: true,
          $elemMatch: {
            $and: [
              { domain: { $regex: "^[A-Za-z0-9-_]+$", $exists: true } },
              { value: { $type: "int", $exists: true } },
            ],
          },
        },
      },
      {
        instances: { $type: "int", $exists: true },
      },
      {
        $or: [{ tracingTime: { $type: "long" } }, { tracingTime: { $exists: false } }],
      },
      {
        created: { $type: "long", $exists: true },
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        _project: { $type: "string", $exists: true },
      },
      {
        $or: [{ _script: { $type: "string" } }, { _script: { $exists: false } }],
      },
      {
        $or: [{ creationInfo: { $type: "string" } }, { creationInfo: { $exists: false } }], //TODO regex
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
