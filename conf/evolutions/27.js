// --- !Ups
db.projects.update({}, {$set: {"assignmentConfig": {"location" : "webknossos"}}}, {multi: true})

// --- !Downs
