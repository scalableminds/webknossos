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
        version: { $type: "int", $exists: true },
      },
      {
        content: { $type: "array", $exists: true },
      },
      {
        $or: [{ deleted: { $type: "bool" } }, { deleted: { $exists: false } }],
      },
      {
        $or: [{ timestamp: { $type: "long" } }, { timestamp: { $exists: false } }],
      },
    ],
  },
});
