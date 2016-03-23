// Add rotation to skeleton tracings

// --- !Ups
db.skeletons.update({}, {"$set" : {"editRotation" : [0.0, 0.0, 0.0]}}, {"multi" : true})
db.volumes.update({}, {"$set" : {"editRotation" : [0.0, 0.0, 0.0]}}, {"multi" : true})

// --- !Downs
db.skeletons.update({}, {"$unset" : {"editRotation" : ""}}, {"multi" : true})
db.volumes.update({}, {"$unset" : {"editRotation" : ""}}, {"multi" : true})
