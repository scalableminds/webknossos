db.runCommand({
  collMod: "dataStores",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true },
      },
      {
        url: { $regex: "^https?:/{2}[a-z0-9.]+(.[a-z]{2,3})?(:[0-9]+)?$", $exists: true }, // https://data1....
      },
      {
        typ: { $in: ["webknossos-store", "ndstore"], $exists: true },
      },
      {
        key: { $type: "string", $exists: true },
      },
    ],
  },
});
