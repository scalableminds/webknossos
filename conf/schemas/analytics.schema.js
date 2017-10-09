db.runCommand({
  collMod: "analytics",
  validator: {
    $and: [
      {
        $or: [{ user: { $type: "objectId" } }, { user: { $exists: false } }],
      },
      {
        namespace: { $type: "string", $exists: true },
      },
      {
        value: { $type: "object", $exists: true },
      },
      {
        timestamp: { $type: "number", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
