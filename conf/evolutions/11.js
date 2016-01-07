// Update users to add 'md5hash' property

// --- !Ups
db.users.update({}, {"$set" : {"md5hash" : ""}}, {"multi" : true})

// --- !Downs
db.users.update({}, {"$unset" : {"md5hash" : ""}}, {"multi" : true})
