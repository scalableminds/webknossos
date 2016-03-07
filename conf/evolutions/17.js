// Update tasks to create open assignments

// --- !Ups
db.tasks.find().forEach(function(elem){
  var neededAssignments = elem.instances - elem.assignedInstances
  for (i = 0; i < neededAssignments; i++) {
    db.openAssignments.insert({
      "_task": elem._id,
      "team": elem.team,
      "_project": elem._project,
      "neededExperience": elem.neededExperience,
      "priority": elem.priority,
      "created": elem.created
    })
  }
})

// --- !Downs
db.tasks.find().forEach(function(elem){
  db.tasks.update({"_id" : elem._id}, {"$set": {"assignedInstances" : elem.instances}})
})

db.openAssignments.find().forEach(function(elem){
  db.tasks.update({"_id" : elem._id}, {"$inc": {"assignedInstances" : -1} })
})

db.openAssignments.remove({})
