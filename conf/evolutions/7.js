// Update to move zoomLevel from user settings zo tracings

// --- !Ups
db.users.update({}, {$unset: {"configuration.settings.zoom": 0.0}}, {multi: true})
db.volumes.update({}, {$set: {"zoomLevel": 0.0}}, {multi: true})
db.skeletons.update({}, {$set: {"zoomLevel": 0.0}}, {multi: true})

// --- !Downs
db.users.update({}, {$set: {"configuration.settings.zoom": 0.0}}, {multi: true})
db.volumes.update({}, {$unset: {"zoomLevel": 0.0}}, {multi: true})
db.skeletons.update({}, {$unset: {"zoomLevel": 0.0}}, {multi: true})

