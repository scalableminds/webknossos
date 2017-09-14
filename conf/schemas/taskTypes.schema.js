db.runCommand({
  collMod: "taskTypes",
  validator: {
    $and: [
      {
        summary: { $type: "string", $exists: true },
      },
      {
        description: { $type: "string", $exists: true },
      },
      {
        team: { $type: "string", $exists: true },
      },
      {
        settings: {
          $type: "object",
          $exists: true,
          $elemMatch: {
            $and: [
              { allowedModes: { $type: "array", $exists: true } },
              {
                $or: [
                  { preferredMode: { $type: "string" } },
                  { preferredMode: { $exists: false } },
                ],
              },
              { branchPointsAllowed: { $type: "bool", $exists: true } },
              { somaClickingAllowed: { $type: "bool", $exists: true } },
              { advancedOptionsAllowed: { $type: "bool", $exists: true } },
            ],
          },
        },
      },
      {
        $or: [{ fileName: { $type: "string" } }, { fileName: { $exists: false } }],
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
