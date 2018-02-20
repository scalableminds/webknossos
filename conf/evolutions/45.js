
// --- !Ups
db.getCollection('users').update({}, {$unset: {"md5hash":0}}, { multi: true });

// --- !Downs
db.getCollection('users').update({}, {$set: {"md5hash": ""}}, { multi: true });
