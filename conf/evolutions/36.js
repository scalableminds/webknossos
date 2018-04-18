// Store instance count with a single OpenAssignments
// Note that the Down splits them into OpenAssignments with just 1 instance.

// --- !Ups
db.openAssignments.aggregate([
  {$group: {
    _id: "$_task",
    _task: {$first: "$_task"},
    team: {$first: "$team"},
    _project: {$first: "$_project"},
    neededExperience: {$first: "$neededExperience"},
    priority: {$first: "$priority"},
    created: {$first: "$created"},
    instances: {$sum: "$instances"},
  }}
], {allowDiskUse:true}).forEach(function(assignment) {
  db.openAssignments_aggregated.insert(assignment);
});
db.openAssignments.renameCollection("openAssignments_multiplePerTask");
db.openAssignments_aggregated.renameCollection("openAssignments");

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
