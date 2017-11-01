db.runCommand({
  collMod: "userAgentTracking",
  validator: {
    $and: [
      {
        $or: [{ user: { $type: "objectId" } }, { user: { $exists: false } }],
      },
      {
        userAgent: { $type: "string", $exists: true },
      },
      {
        timestamp: { $type: "number", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
