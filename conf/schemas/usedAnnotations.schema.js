db.runCommand({
  collMod: "usedAnnotations",
  validator: {
    $and: [
      {
        user: { $type: "objectId", $exists: true },
      },
      {
        annotationId: { $type: "object", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
