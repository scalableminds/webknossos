db.runCommand({
  collMod: "mturkSQS",
  validator: {
    $and: [
      {
        name: { $regex: "^[A-Za-z0-9-_]+$", $exists: true },
      },
      {
        url: { $regex: "^https?:/{2}[a-z0-9.]+(.[a-z]{2,3})?(:[0-9]+)?$", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
