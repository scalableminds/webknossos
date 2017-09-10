db.runCommand({
  collMod: "mturkSQS",
  validator: {
    $and: [
      {
        name: { $type: "string", $exists: true },
      },
      {
        url: { $type: "string", $exists: true },
      },
    ],
  },
});
