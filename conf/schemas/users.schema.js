db.runCommand({
  collMod: "users",
  validator: {
    $and: [
      {
        email: { $type: "string", $exists: true },
      },
      {
        firstName: { $type: "string", $exists: true },
      },
      {
        lastName: { $type: "string", $exists: true },
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        pwdHash: { $type: "string", $exists: true },
      },
      {
        md5hash: { $type: "string", $exists: true },
      },
      {
        teams: { $type: "array", $exists: true },
      },
      {
        userConfiguration: { $type: "object", $exists: true },
      },
      {
        dataSetConfigurations: { $type: "object", $exists: true },
      },
      {
        experiences: { $type: "object", $exists: true },
      },
      {
        lastActivity: { $type: "long", $exists: true },
      },
      {
        $or: [{ _isAnonymous: { $type: "bool" } }, { _isAnonymous: { $exists: false } }],
      },
      {
        $or: [{ _isSuperUser: { $type: "bool" } }, { _isSuperUser: { $exists: false } }],
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
