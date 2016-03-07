// --- !Ups
db.taskTypes.update({}, {$set: {"isActive": true}}, {multi: true})
db.tasks.update({}, {$set: {"isActive": true}}, {multi: true})
db.annotations.update({}, {$set: {"isActive": true}}, {multi: true})

// --- !Downs
db.taskTypes.update({}, {$unset: {"isActive": 0}}, {multi: true})
db.tasks.update({}, {$unset: {"isActive": 0}}, {multi: true})
db.annotations.update({}, {$unset: {"isActive": 0}}, {multi: true})
