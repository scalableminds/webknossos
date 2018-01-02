// Directly integrate OpenAnnotations into Tasks

// --- !Ups
db.openAssignments.find().forEach(function(assignment) {
  db.tasks.update({"_id": assignment._task}, {$set: {"openInstances": assignment.instances}})
})
db.projects.find("isPaused": false).forEach(function(project) {
  db.tasks.update({"_project": project._id}, {$set: {"priority": project.priority}})
})
db.tasks.update("priority": {$exists: false}, {$set: {"priority" : -1})
db.tasks.update("openInstances": {$exists: false}, {$set: {"openInstances": 0}})

db.openAssignments.renameCollection("_openAssignments");
db.mturkAssignments.renameCollection("_mturkAssignments");


// --- !Downs
db.openAssignments.renameCollection("openAssignments_aggregated");
db.openAssignments_aggregated.find().forEach(function(assignment) {
  var instanceCount = assignment.instances;
  delete assignment.instances;
  delete assignment._id;
  for (var i=0; i<instanceCount; i++) {
    db.openAssignments.insert(assignment);
  }
});
