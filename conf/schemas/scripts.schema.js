db.runCommand({
  collMod: "scripts",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true },
      },
      {
        gist: { $regex: "@^(https?|ftp)://[^s/$.?#].[^s]*$@iS", $exists: true },
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
