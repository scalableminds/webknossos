// Move Branchpoints / Comments to tree level

// --- !Ups
db.trees.remove({"_tracing" : { $exists: false }});

var treeCursor = db.trees.find().noCursorTimeout();

treeCursor.forEach(function(tree){
  var skeletons = db.skeletons.find({"_id" : tree._tracing});
  if(skeletons.hasNext()){
    var skeleton = skeletons[0]
    var branchPoints = [];

    skeleton.branchPoints.forEach(function(bp){
      var node = db.nodes.find({"_treeId" : tree._id, "node.id" : bp.id});
      if(node.hasNext()){
        bp.timestamp = node.next().node.timestamp;
        branchPoints.push(bp)
      }
    });

    var comments = [];

    skeleton.comments.forEach(function(comment){
      var node = db.nodes.find({"_treeId" : tree._id, "node.id" : comment.node});
      if(node.hasNext()){
        comment.timestamp = node.next().node.timestamp;
        comments.push(comment)
      }
    });

    db.trees.update({"_id" : tree._id}, {"$set": {"branchPoints" : branchPoints, "comments" : comments}})
  }
});

treeCursor.close();

// --- !Downs

db.skeletons.find().forEach(function(skeleton){
  var branchPoints = [];
  var comments = [];

  db.trees.find({"_tracing" : skeleton._id}).forEach(function(tree){
    branchPoints = branchPoints.concat(tree.branchPoints);
    comments = comments.concat(tree.comments);
  });

  db.skeletons.update({"_id" : skeleton._id}, {"$set": {"branchPoints" : branchPoints.sort(function(a, b){return b.timestamp-a.timestamp}), "comments" : comments}})
});
