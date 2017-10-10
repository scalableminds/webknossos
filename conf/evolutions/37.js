// Update to support "description" attribute for annotations

// --- !Ups
db.annotations.update({}, { $set: { description: "" } }, { multi: true });

// --- !Downs
db.annotations.update({}, { $unset: { description: 1 } }, { multi: true });

