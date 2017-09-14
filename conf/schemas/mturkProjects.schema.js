db.runCommand({
  collMod: "mturkProjects",
  validator: {
    $and: [
      {
        _project: { $type: "string", $exists: true },
      },
      {
        hitTypeId: { $type: "string", $exists: true }, //TODO
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        numberOfOpenAssignments: { $type: "int", $exists: true },
      },
    ],
  },
});
