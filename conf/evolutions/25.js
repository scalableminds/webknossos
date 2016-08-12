// Move Branchpoints / Comments to tree level

// --- !Ups
db.trees.remove({"_tracing": {$exists: false}});

db.trees.update({"branchPoints": {"$exists": false}}, {"$set": {"branchPoints": [], "comments": []}}, {"multi": true});

{
  var finished = false;
  while (!finished) {
    try {
      db.skeletons.find({
        "notUpdated": {"$exists": false},
        "$or": [{"branchPoints": {"$gt": []}}, {"comments": {"$gt": []}}]
      }).sort({"_id": 1}).forEach(function (skeleton) {
        printjson(skeleton._id);
        var branchPoints = skeleton.branchPoints;
        var bpids = branchPoints.map(function (bp) {
          return bp.id
        });
        var comments = skeleton.comments;
        var cids = comments.map(function (c) {
          return c.node
        });
        var nodeIds = bpids.concat(cids);

        var trees = db.trees.find({"_tracing": skeleton._id}).toArray();
        trees.forEach(function (tree) {
          var treeBranchPoints = [];
          var treeComments = [];

          var nodes = db.nodes.find({"_treeId": tree._id, "node.id": {"$in": nodeIds}}).toArray();

          for (var j = 0; j < nodes.length; j++) {
            var node = nodes[j];
            for (var i = branchPoints.length - 1; i >= 0; i--) {
              if (branchPoints[i].id == node.node.id) {
                treeBranchPoints.push({"id": node.node.id, "timestamp": node.node.timestamp});
                branchPoints.splice(i, 1);
              }
            }
            for (var i = comments.length - 1; i >= 0; i--) {
              if (comments[i].node == node.node.id) {
                treeComments.push({
                  "node": node.node.id,
                  "content": comments[i].content,
                  "timestamp": node.node.timestamp
                });
                comments.splice(i, 1);
              }
            }
          }

          db.trees.update({"_id": tree._id}, {
            "$set": {
              "branchPoints": treeBranchPoints,
              "comments": treeComments
            }
          }, {"writeConcern": {"w": 0}});
        });

        db.skeletons.update({"_id": skeleton._id}, {"$set": {"notUpdated": true}}, {"writeConcern": {"w": 0}});
      });
      finished = true
    } catch (err) {
      print("Cursor exited! Restarting....");
    }
  }
}

// --- !Downs

db.skeletons.find().forEach(function (skeleton) {
  var branchPoints = [];
  var comments = [];

  db.trees.find({"_tracing": skeleton._id}).forEach(function (tree) {
    if (tree.branchPoints)
      branchPoints = branchPoints.concat(tree.branchPoints);
    if (tree.comments)
      comments = comments.concat(tree.comments);
  });

  db.skeletons.update({"_id": skeleton._id},
    {
      "$set": {
        "branchPoints": branchPoints.sort(function (a, b) {
          return b.timestamp - a.timestamp
        }), "comments": comments
      },
      "$unset": {"notUpdated": true}
    })
});


db.skeletons.find({}).forEach(function (skeleton) {
  db.trees.update({"_tracing": skeleton._id}, {"$set": {"activeTree": true}}, {"multi": true})
});
