db.runCommand({
  collMod: "teams",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_ ]+$", $exists: true },
      },
      {
        $or: [{ parent: { $type: "string" } }, { parent: { $exists: false } }],
      },
      {
        roles: { $type: "object", $exists: true },
      },
      {
        "roles.name": { $type: "string", $exists: true },
      },
      {
        $or: [{ owner: { $type: "objectId" } }, { owner: { $exists: false } }],
      },
      {
        $or: [
          { behavesLikeRootTeam: { $type: "bool" } },
          { behavesLikeRootTeam: { $exists: false } },
        ],
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
