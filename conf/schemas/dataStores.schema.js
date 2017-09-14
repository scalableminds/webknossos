db.runCommand({
  collMod: "dataStores",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true }, // https://data1....
      },
      {
        url: { $regex: "^(https?|ftp)://[^s/$.?#].[^s]*$@iS", $exists: true },
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
