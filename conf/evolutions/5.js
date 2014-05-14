// --- !Ups
db.dataSets.update({}, {"$set" : {"dataStoreInfo" : {"name" : "localhost", "url" : "http://localhost:9000"}}}, {"multi" : true})

// --- !Downs
