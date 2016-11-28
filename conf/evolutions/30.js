// --- !Ups
db.users.update({}, {$rename: {"verified": "isActive"}}, {multi: true})

// --- !Downs
db.users.update({}, {$rename: {"isActive": "verified"}}, {multi: true})
