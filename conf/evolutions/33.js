// --- !Ups
db.users.update({}, { $unset: { "userConfiguration.configuration.firstVisToggle": 1 } }, { multi: true });

// --- !Downs
db.users.update({}, { $set: { "userConfiguration.configuration.firstVisToggle": true } }, { multi: true });
