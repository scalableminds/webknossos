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
        token: { $type: "string", $exists: true },
      },
      {
        expiration: { $type: "long", $exists: true },
      },
    ],
  },
});
