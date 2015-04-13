// Update to add 'isWritable' property to layers

// --- !Ups
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})
db.userDataLayers.update({}, {"$set": {"dataLayer.mappings": []}}, {"multi" : true})

// --- !Downs
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})
db.userDataLayers.update({}, {"$unset": {"dataLayer.mappings": ""}}, {"multi" : true})
