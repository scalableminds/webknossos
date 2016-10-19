// --- !Ups
db.mturkAssignments.update({}, {$set: {"numberOfInProgressAssignments": 0}}, {multi: true})

// --- !Downs
