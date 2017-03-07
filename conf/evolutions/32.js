// --- !Ups
db.userDataLayers.update({}, {$set: {"dataLayer._isCompressed": false}}, {multi: true});

// --- !Downs
