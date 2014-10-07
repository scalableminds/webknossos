// --- !Ups
db.annotations.find({"_name" : {"$exists" : true}}).forEach(function (annotation) {
  var name = annotation._name.replace(".nml", "");

  db.annotations.update({"_id" : annotation._id}, {"$set" : {"_name" : name }});
})
// --- !Downs
