// --- !Ups
db.userDataLayers.update({}, {$set: {"dataLayer._isCompressed": false}}, {"multi": true});

db.dataSets.find().forEach(function (elem) {
  if(elem.dataSource) {
    var dataLayers = elem.dataSource.dataLayers;
    for (var i = 0; i < dataLayers.length; i++) {
      dataLayers[i]["_isCompressed"] = false;
    }
    db.dataSets.update({"_id": elem._id}, {"$set": {"dataSource.dataLayers": dataLayers}});
  }
});

// --- !Downs
