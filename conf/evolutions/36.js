// Update to support tags in annotations

// --- !Ups
db.annotations.update({}, { $set: { tags: [] } }, { multi: true });

// --- !Downs
db.annotations.update({}, { $unset: { tags: 1 } }, { multi: true });
