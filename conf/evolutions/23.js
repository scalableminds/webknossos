// --- !Ups
db.dataSets.update({"dataStoreInfo.typ" : {"$exists" : false}}, {$set: {"dataStoreInfo.typ": "webknossos-store"}}, {multi: true})

db.dataStores.update({"typ" : {"$exists" : false}}, {$set: {"typ": "webknossos-store"}}, {multi: true})

// --- !Downs