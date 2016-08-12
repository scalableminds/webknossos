// --- !Ups
db.projects.update({}, {$set: {"priority": 100}}, {multi: true})

// --- !Downs
