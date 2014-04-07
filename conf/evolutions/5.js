// --- !Ups
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}, "$set" : {"dataStoreInfo" : {}}}, {"multi" : true})

// --- !Downs
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})