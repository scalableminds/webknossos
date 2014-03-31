// Update to support new dataset / datalayer format

// --- !Ups
db.userDataLayers.find().forEach(function (dl) {
  dl.dataLayer.name = dl.name;
  dl.dataLayer.category = dl.dataLayer.typ;
  dl.dataLayer.fallback = {
    "layerName" : dl.dataLayer.typ,
    "dataSourceName" : dl.dataLayer.fallback
  }
  db.userDataLayers.save(dl);
})

db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})

// --- !Downs
db.dataSets.update({}, {"$unset" : {"dataSource" : ""}}, {"multi" : true})