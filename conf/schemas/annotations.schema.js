db.runCommand({
  collMod: "annotations",
  validator: {
    $and: [
      {
        $or: [{ _user: { $type: "objectId" } }, { _user: { $exists: false } }],
      },
      {
        _content: { $type: "object", $exists: true },
      },
      {
        "_content.contentType": { $in: ["skeletonTracing", "volumeTracing"], $exists: true },
      },
      {
        "_content._id": { $regex: /^[a-f\d]{24}$/i, $exists: true },
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
        "state.isAssigned": { $type: "bool", $exists: true },
      },
      {
        "state.isFinished": { $type: "bool", $exists: true },
      },
      {
        "state.isInProgress": { $type: "bool", $exists: true },
      },
      {
        typ: {
          $exists: true,
          $in: [
            "Task",
            "View",
            "Explorational",
            "CompoundTask",
            "CompoundProject",
            "CompoundTaskType",
            "Tracing Base",
            "Orphan",
          ],
        },
      },
      {
        version: { $type: "number", $exists: true },
      },
      {
        $or: [{ _name: { $type: "string" } }, { _name: { $exists: false } }],
      },
      {
        $or: [{ tracingTime: { $type: "number" } }, { tracingTime: { $exists: false } }],
      },
      {
        $or: [{ created: { $type: "number" } }, { created: { $exists: false } }],
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
        tags: { $exists: true },
      },
      {
        $or: [{ tags: { $type: "string" } }, { tags: { $size: 0 } }],
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
