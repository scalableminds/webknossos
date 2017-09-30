db.runCommand({
  collMod: "annotationUpdates",
  validator: {
    $and: [
      {
        typ: { $type: "string", $exists: true },
      },
      {
        annotationId: { $type: "string", $exists: true },
      },
      {
        version: { $type: "number", $exists: true },
      },
      {
        content: { $exists: true },
      },
      {
        $or: [{ content: { $type: "object" } }, { content: { $size: 0 } }], //4000 size 0
      },
      {
        $or: [{ deleted: { $type: "bool" } }, { deleted: { $exists: false } }],
      },
      {
        $or: [{ timestamp: { $type: "number" } }, { timestamp: { $exists: false } }],
      },
    ],
  },
  validationAction: "warn",
  validationLevel: "strict",
});
//no errors