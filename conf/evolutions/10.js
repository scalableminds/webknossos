// Update to add 'isWritable' property to layers

// --- !Ups
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})

// --- !Downs
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})
