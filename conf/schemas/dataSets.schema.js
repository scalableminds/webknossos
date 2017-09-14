db.runCommand({
  collMod: "dataSets",
  validator: {
    $and: [
      {
        dataStoreInfo: {
          $type: "object",
          $exists: true,
          $elemMatch: {
            $and: [
              { name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true } },
              { url: { $regex: "@^(https?|ftp)://[^s/$.?#].[^s]*$@iS", $exists: true } },
              { typ: { $in: ["webknossos-store", "ndstore"], $exists: true } },
              { $or: [{ accessToken: { $type: "string" } }, { accessToken: { $exists: false } }] },
            ],
          },
        },
      },
      {
        dataSource: {
          $type: "object",
          $exists: true,
          $elemMatch: {
            $and: [
              {
                id: {
                  $type: "object",
                  $exists: true,
                  $elemMatch: {
                    $and: [
                      { name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true } },
                      { team: { $type: "string", $exists: true } },
                    ],
                  },
                },
              },
              { dataLayers: { $type: "array", $exists: true } },
              { scale: { $type: "array", $exists: true } },
            ],
          },
        },
      },
      {
        allowedTeams: { $type: "array", $exists: true }, //TODO
      },
      {
        isActive: { $type: "bool", $exists: true },
      },
      {
        isPublic: { $type: "bool", $exists: true },
      },
      {
        $or: [{ description: { $type: "string" } }, { description: { $exists: false } }],
      },
      {
        $or: [
          { defaultConfiguration: { $type: "object" } }, //TODO - no data existent
          { defaultConfiguration: { $exists: false } },
        ],
      },
      {
        created: { $type: "long", $exists: true },
      },
    ],
  },
});
