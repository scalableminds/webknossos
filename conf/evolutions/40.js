// Directly integrate OpenAnnotations into Tasks, deprecate mturkAssignments

// --- !Ups
db.openAssignments.find().forEach(function(assignment) {
  db.tasks.update({"_id": assignment._task}, {$set: {"openInstances": assignment.instances}});
})
db.projects.find({"paused": false}).forEach(function(project) {
  db.tasks.update({"_project": project.name}, {$set: {"priority": project.priority}}, {multi: true});
})
db.tasks.update({"priority": {$exists: false}}, {$set: {"priority" : -1}}, {multi: true});
db.tasks.update({"openInstances": {$exists: false}}, {$set: {"openInstances": 0}}, {multi: true});

db.openAssignments.renameCollection("_openAssignments");
db.mturkAssignments.renameCollection("_mturkAssignments");


// --- !Downs
db.tasks.find({"openInstances": {$gt: 0}}).forEach(function(task) {
	db.openAssignments.insert({
		_task: task._id,
		team: task.team,
		_project: task.project,
		neededExperience: task.neededExperience,
		priority: task.priority,
		created: task.created,
		instances: task.openInstances
	});
});
db.tasks.update({}, {$unset: {"openInstances": "", "priority": ""}});

db.getCollection("_mturkAssignments").renameCollection("mturkAssignments");
