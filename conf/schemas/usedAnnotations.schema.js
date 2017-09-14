db.runCommand({
  collMod: "usedAnnotations",
  validator: {
    $and: [
      {
        user: { $type: "objectId", $exists: true },
      },
      {
        annotationId: {
          $type: "object",
          $exists: true,
          $elemMatch: {
            $and: [
              { annotationType: { $type: "string", $exists: true } },
              { identifier: { $type: "string", $exists: true } },
            ],
          },
        },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
