db.runCommand({
  collMod: "scripts",
  validator: {
    $and: [
      {
        name: { $type: "string", $exists: true },
      },
      {
        gist: { $type: "string", $exists: true },
      },
      {
        _owner: { $type: "string", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
