// Consolidate Annotation States (both InProgress and Assigned become Active, Unassigned becomes Cancelled)

// --- !Ups
db.annotations.update({"state":"InProgress"}, {$set: {"state": "Active"}}, {"multi":true});
db.annotations.update({"state":"Assigned"}, {$set: {"state": "Active"}}, {"multi":true});
db.annotations.update({"state":"Unassigned"}, {$set: {"state": "Cancelled"}}, {"multi":true});

// --- !Downs
db.annotations.update({"state":"Active"}, {$set: {"state": "InProgress"}}, {"multi":true});
db.annotations.update({"state":"Cancelled"}, {$set: {"state": "Unassigned"}}, {"multi":true});
