// Store instance count with a single OpenAnnotations

// --- !Ups
db.openAssignments.renameCollection("openAssignments_singeInstance");
db.openAssignments_singeInstance.aggregate([
  {$group: {
    _id: "$_task",
    _task: {$first: "$_task"},
    team: {$first: "$team"},
    _project: {$first: "$_project"},
    neededExperience: {$first: "$neededExperience"},
    priority: {$first: "$priority"},
    created: {$first: "$created"},
    instances: {$sum: 1},
  }}
]).forEach(function(assignment) {
  delete assignment._id;
  db.openAssignments.insert(assignment);
});

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
