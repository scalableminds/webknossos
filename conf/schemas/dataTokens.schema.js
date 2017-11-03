db.runCommand({
  collMod: "dataTokens",
  validator: {
    $and: [
      {
        $or: [{ _user: { $type: "objectId" } }, { _user: { $exists: false } }],
      },
      {
        $or: [{ dataSetName: { $type: "string" } }, { dataSetName: { $exists: false } }],
      },
      {
        $or: [{ dataLayerName: { $type: "string" } }, { dataLayerName: { $exists: false } }],
      },
      {
        token: { $regex: "^[a-z0-9]{26}$", $exists: true },
      },
      {
        expiration: { $type: "number", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
