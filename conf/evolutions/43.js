// Remove support for "advanced tracing options flag"

// --- !Ups
db.annotations.update({}, { $unset: { "settings.advancedOptionsAllowed": "" } }, { multi: true });

// --- !Downs
db.annotations.update({}, { $set: { "settings.advancedOptionsAllowed": true } }, { multi: true });

