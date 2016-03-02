// Add rotation to every node

// --- !Ups
db.nodes.update({}, {"$set" : {"node.rotation" : [0.0, 0.0, 0.0]}}, {"multi" : true})

// --- !Downs
db.nodes.update({}, {"$unset" : {"node.rotation" : ""}}, {"multi" : true})
