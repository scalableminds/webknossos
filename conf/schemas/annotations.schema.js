db.runCommand({
  collMod: "annotations",
  validator: {
    $and: [
      {
        $or: [{ _user: { $type: "objectId" } }, { _user: { $exists: false } }],
      },
      {
        content: { $type: "object", $exists: true },
      },
      {
        $or: [{ _task: { $type: "objectId" } }, { _task: { $exists: false } }],
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        state: { $type: "object", $exists: true },
      },
      {
        typ: { $type: "string", $exists: true },
      },
      {
        version: { $type: "int", $exists: true },
      },
      {
        $or: [{ _name: { $type: "string" } }, { _name: { $exists: false } }],
      },
      {
        $or: [{ tracingTime: { $type: "long" } }, { tracingTime: { $exists: false } }],
      },
      {
        created: { $type: "long", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        $or: [{ readOnly: { $type: "bool" } }, { readOnly: { $exists: false } }],
      },
      {
        isPublic: { $type: "bool", $exists: true },
      },
      {
        tags: { $type: "array", $exists: true },
      },
    ],
  },
});
