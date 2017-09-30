db.runCommand({
  collMod: "mturkProjects",
  validator: {
    $and: [
      {
        _project: { $type: "string", $exists: true },
      },
      {
        hitTypeId: { $type: "string", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        numberOfOpenAssignments: { $type: "number", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
