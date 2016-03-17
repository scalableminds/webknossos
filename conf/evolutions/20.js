// --- !Ups
db.tasks.update({}, {$set: {"directLinks": []}}, {multi: true})

// --- !Downs
db.taskTypes.update({}, {$unset: {"directLinks": 1}}, {multi: true})
