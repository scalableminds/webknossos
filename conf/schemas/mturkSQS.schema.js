db.runCommand({
  collMod: "mturkSQS",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true },
      },
      {
        url: { $regex: "@^(https?|ftp)://[^s/$.?#].[^s]*$@iS", $exists: true },
      },
    ],
  },
});
