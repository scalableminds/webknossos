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
          {
            $and: [
              { "dataSource.dataLayers": { $type: "object" } },
              { "dataSource.dataLayers.name": { $type: "string" } },
              { "dataSource.dataLayers.category": { $in: ["color", "mask", "segmentation"] } },
              { "dataSource.dataLayers.boundingBox": { $type: "object" } },
              { "dataSource.dataLayers.boundingBox.topLeft": { $type: "number", $exists: true } },
              { "dataSource.dataLayers.boundingBox.width": { $type: "number", $exists: true } },
              { "dataSource.dataLayers.boundingBox.height": { $type: "number", $exists: true } },
              { "dataSource.dataLayers.boundingBox.depth": { $type: "number", $exists: true } },
              { "dataSource.scale": { $type: "number", $exists: true, $size: 3 } },
            ],
          },
          {
            "dataSource.dataLayers": { $size: 0 },
          },
          {
            "dataSource.status": { $type: "string", $exists: true },
          },
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
          { defaultConfiguration: { $type: "object" } },
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
