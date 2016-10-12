// --- !Ups
db.projects.update({}, {$set: {"paused": false}}, {multi: true})

// --- !Downs
db.projects.update({}, {$unset: {"paused": true}}, {multi: true})
