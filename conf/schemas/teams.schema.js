db.runCommand({
  collMod: "teams",
  validator: {
    $and: [
      {
        name: { $type: "string", $exists: true },
      },
      {
        $or: [{ parent: { $type: "string" } }, { parent: { $exists: false } }],
      },
      {
        roles: { $type: "array", $exists: true },
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
});
