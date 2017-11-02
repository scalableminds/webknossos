db.runCommand({
  collMod: "scripts",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_.]+$", $exists: true },
      },
      {
        gist: { $regex: "^https?:/{2}[a-z0-9.]+/?([a-z0-9]/?)*(:[0-9]+)?$", $exists: true },
      },
      {
        _owner: { $type: "string", $exists: true }, //REGEX
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
