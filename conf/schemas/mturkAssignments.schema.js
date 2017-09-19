db.runCommand({
  collMod: "mturkAssignments",
  validator: {
    $and: [
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
        hitId: { $type: "string", $exists: true }, //TODO
      },
      {
        key: { $type: "string", $exists: true }, //TODO
      },
      {
        numberOfOpenAssignments: { $type: "int", $exists: true },
      },
      {
        numberOfInProgressAssignments: { $type: "int", $exists: true },
      },
      {
        created: { $type: "long", $exists: true },
      },
      {
        annotations: {
          $type: "array",
          $exists: true,
          $elemMatch: {
            $elemMatch: {
              $and: [
                { _annotation: { $type: "objectId", $exists: true } },
                { _user: { $type: "objectId", $exists: true } },
                { assignmentId: { $type: "string", $exists: true } },
              ],
            },
          },
        },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationLevel: "strict",
});
