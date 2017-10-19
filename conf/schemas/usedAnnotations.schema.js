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
        "annotationId.annotationType": { $type: "string", $exists: true }, //IN
      },
      {
        "annotationId.identifier": { $type: "string", $exists: true }, //REGEX
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
