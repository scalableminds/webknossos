// --- !Ups
db.projects.update({}, {$set: {"assignmentConfiguration": {"location" : "webknossos"}}}, {multi: true})

// --- !Downs
