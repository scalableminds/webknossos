db.runCommand({
  collMod: "dataStores",
  validator: {
    $and: [
      {
        name: { $type: "string", $exists: true }, // https://data1....
      },
      {
        url: { $type: "string", $exists: true}
      },
      {
        typ: { $in: ["webknossos-store", "ndstore"], $exists: true}
      },
      {
        key: { $type: "string", $exists: true}
      }
    ],
  },
});
