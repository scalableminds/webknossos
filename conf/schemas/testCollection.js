db.collection.find().forEach(function(doc) {
  try {
    db.collection_verified.insertOne(doc);
  } catch (err) {
    db.collection_unverified.insertOne(doc);
  }
});
