// Add advanced tracing options to task types and convert time limits to minutes

// --- !Ups
db.taskTypes.update({}, {"$set" : {"settings.advancedOptionsAllowed" : true}}, {"multi" : true})

db.taskTypes.find().forEach(function(elem){
  elem.expectedTime.min = elem.expectedTime.min * 60;
  elem.expectedTime.max = elem.expectedTime.max * 60;
  elem.expectedTime.maxHard = elem.expectedTime.maxHard * 60;

  db.taskTypes.save(elem);
})

db.skeletons.update({}, {"$set" : {"settings.advancedOptionsAllowed" : true}}, {"multi" : true})
db.volumes.update({}, {"$set" : {"settings.advancedOptionsAllowed" : true}}, {"multi" : true})

// --- !Downs
db.taskTypes.update({}, {"$unset" : {"settings.advancedOptionsAllowed" : ""}}, {"multi" : true})
db.skeletons.update({}, {"$unset" : {"settings.advancedOptionsAllowed" : ""}}, {"multi" : true})
db.volumes.update({}, {"$unset" : {"settings.advancedOptionsAllowed" : ""}}, {"multi" : true})

db.taskTypes.find().forEach(function(elem){
  elem.expectedTime.min = elem.expectedTime.min / 60;
  elem.expectedTime.max = elem.expectedTime.max / 60;
  elem.expectedTime.maxHard = elem.expectedTime.maxHard / 60;

  db.taskTypes.save(elem);
})
