db.runCommand({
  collMod: "timeSpans",
  validator: {
    $and: [
      {
        time: { $type: "long", $exists: true },
      },
      {
        timestamp: { $type: "long", $exists: true },
      },
      {
        lastUpdate: { $type: "long", $exists: true },
      },
      {
        _user: { $type: "objectId", $exists: true },
      },
      {
        $or: [{ note: { $type: "string" } }, { note: { $exists: false } }],
      },
      {
        $or: [{ annotation: { $type: "string" } }, { annotation: { $exists: false } }],
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
      {
        $or: [{ numberOfUpdates: { $type: "long" } }, { numberOfUpdates: { $exists: false } }],
      },
    ],
  },
});
