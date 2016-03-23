// --- !Ups
db.tasks.update({"isActive": {$exists: false}}, {$set: {"isActive": true}}, {multi: true})

// --- !Downs
