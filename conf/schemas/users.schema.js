db.runCommand({
  collMod: "users",
  validator: {
    $and: [
      {
        email: {
          $regex: "^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:.[a-zA-Z0-9-]+)*$",
          $exists: true,
        },
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
        teams: {
          $type: "array",
          $exists: true,
          $elemMatch: {
            $and: [
              { team: { $type: "string", $exists: true } },
              {
                role: { $type: "object", $exists: true, $elemMatch: { name: { $type: "string" } } },
              },
            ],
          },
        },
      },
      {
        userConfiguration: {
          $type: "object",
          $exists: true,
          $elemMatch: { configuration: { $type: "object", $exists: true } },
        },
      },
      {
        dataSetConfigurations: { $type: "object", $exists: true },
      },
      {
        experiences: { $type: "object", $exists: true }, //TODO
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
