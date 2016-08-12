// Update to eliminate old tracing modes

// --- !Ups
db.taskTypes.update(
  {"settings.allowedModes" : "oxalis"},
  {"$addToSet": {"settings.allowedModes" : "orthogonal"}}, {"multi" : true})

db.taskTypes.update(
  {"settings.allowedModes" : "oxalis"},
  {"$pull" : {"settings.allowedModes" : "oxalis"}}, {"multi" : true})

db.taskTypes.update(
  {"settings.allowedModes" : "arbitrary"},
  {"$push": {"settings.allowedModes" : {"$each" : ["oblique", "flight"]}}}, {"multi" : true})

db.taskTypes.update(
  {"settings.allowedModes" : "arbitrary"},
  {"$pull" : {"settings.allowedModes" : "arbitrary"}}, {"multi" : true})

// --- !Downs
