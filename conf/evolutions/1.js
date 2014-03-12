// Update to support teams

// --- !Ups
db.timeTracking.find().forEach(function (tt) {
  tt.timeEntries.forEach(function(te){
    var ts = {
      "time" : te.time,
      "timestamp" : te.timestamp,
      "lastUpdate" : te.timestamp,
      "_user" : tt.user
    }

    if(te.annotation)
      ts.annotation = te.annotation

    db.timeSpans.insert(ts)
  })
})

// --- !Downs
db.timeSpans.drop()