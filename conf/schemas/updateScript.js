db.collection.find().forEach(function(doc) {
  db.collection.deleteOne({ _id: doc._id });
  db.collection.insertOne(doc);
});
