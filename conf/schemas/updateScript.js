db.collection.find().forEach(function(doc) {
  db.collection.deleteOne({ _id: doc._id });
  try {
    db.collection.insertOne(doc);
  } catch (err) {
    print(doc);
    print(err);
  }
});
