db.runCommand({
  collMod: "dataSets",
  validator: {
    $and: [
      {
        dataStoreInfo: { $type: "object", $exists: true },
      },
      { "dataStoreInfo.name": { $regex: "^[A-Za-z0-9-_.]+$", $exists: true } },
      {
        "dataStoreInfo.url": {
          $regex: "^https?:/{2}[a-z0-9.-]+(.[a-z]{2,3})?(:[0-9]+)?$",
          $exists: true,
        },
      },
      { "dataStoreInfo.typ": { $in: ["webknossos-store", "ndstore"], $exists: true } },
      {
        $or: [
          { "dataStoreInfo.accessToken": { $type: "string" } },
          { "dataStoreInfo.accessToken": { $exists: false } },
        ],
      },
      {
        dataSource: { $type: "object", $exists: true },
      },
      {
        "dataSource.id": { $type: "object", $exists: true },
      },
      {
        "dataSource.id.name": { $regex: "^[A-Za-z0-9-_.]+$", $exists: true },
      },
      {
        "dataSource.id.team": { $type: "string", $exists: true },
      },
      {
        $or: [
          { "dataSource.dataLayers": { $type: "object" } },
          { "dataSource.dataLayers": { $exists: false } },
          { "dataSource.dataLayers": { $size: 0 } },
        ],
      },
      {
        $or: [
          { "dataSource.scale": { $type: "number" } },
          { "dataSource.scale": { $exists: false } },
          { "dataSource.scale": { $size: 0 } },
        ],
      },
      {
        $or: [
          { "dataSource.status": { $type: "string" } },
          { "dataSource.status": { $exists: false } },
        ],
      },
      {
        allowedTeams: { $type: "string", $exists: true },
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
        created: { $type: "number", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
