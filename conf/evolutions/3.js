// Update to add 'isWritable' property to layers

// --- !Ups
db.userDataLayers.update({}, {"$set" : {"dataLayer.isWritable" : true}}, {"multi" : true})

// --- !Downs
db.userDataLayers.update({}, {"$unset" : {"dataLayer.isWritable" : ""}}, {"multi" : true})
