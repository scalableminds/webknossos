// Update to support new dataset / datalayer format

// --- !Ups
db.annotations.find().forEach(function (annotation) {
  var content = annotation._content;
  var contentFetched;

  var cursor;

  if (content.contentType == "skeletonTracing") {
    cursor = db.skeletons.find({"_id" : ObjectId(content._id)});
  } else {
    cursor = db.volumes.find({"_id" : ObjectId(content._id)});
  }

  contentFetched = cursor.hasNext() && cursor.next();

  if (contentFetched)
   db.annotations.update({"_id" : annotation._id}, {"$set" : {"created" : contentFetched.timestamp }});
})


// --- !Downs
db.annotations.update({}, {"$unset" : {"created" : ""}}, {"multi" : true})
