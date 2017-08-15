// Update to support public annotations

// --- !Ups
db.annotations.update({}, { $set: { isPublic: false } }, { multi: true });

// --- !Downs
db.annotations.update({}, { $unset: { isPublic: 1 } }, { multi: true });
