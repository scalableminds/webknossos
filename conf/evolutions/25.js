// Move Branchpoints / Comments to tree level

// --- !Ups
db.trees.remove({"_tracing" : { $exists: false }});

db.trees.update({"branchPoints" : {"$exists" : false}}, {"$set": {"branchPoints" : [], "comments" : []}}, {"multi": true});

db.skeletons.find({"notUpdated": {"$exists" : false}, "$or" : [{"branchPoints" : {"$gt" : []}}, {"comments" : {"$gt" : []}}]}).forEach(function(skeleton){
  db.trees.find({"_tracing" : skeleton._id}).forEach(function(tree){
    var branchPoints = [];

    var nodes = db.nodes.find({"_treeId" : tree._id}).toArray();
    for(var i = 0; i<skeleton.branchPoints.length; i++){
      for(var j = 0; j<nodes.length; j++) {
        if(nodes[j].node.id == skeleton.branchPoints[i].id){
          branchPoints.push({"id" : nodes[j].node.id, "timestamp" : nodes[j].node.timestamp});
          break;
        }
      }
    }

    var comments = [];

    for(var i = 0; i<skeleton.comments.length; i++){
      for(var j = 0; j<nodes.length; j++) {
        if(nodes[j].node.id == skeleton.comments[i].node){
          comments.push({"node" : nodes[j].node.id, "content": skeleton.comments[i].content, "timestamp" : nodes[j].node.timestamp});
          break;
        }
      }
    }

    db.trees.update({"_id" : tree._id}, {"$set": {"branchPoints" : branchPoints, "comments" : comments}});
  });

  db.skeletons.update({"_id" : skeleton._id}, {"$set" : {"notUpdated" : true}});
});


// --- !Downs

db.skeletons.find().forEach(function(skeleton){
  var branchPoints = [];
  var comments = [];

  db.trees.find({"_tracing" : skeleton._id}).forEach(function(tree){
    if(tree.branchPoints)
      branchPoints = branchPoints.concat(tree.branchPoints);
    if(tree.comments)
      comments = comments.concat(tree.comments);
  });

  db.skeletons.update({"_id" : skeleton._id},
    {"$set": {"branchPoints" : branchPoints.sort(function(a, b){return b.timestamp-a.timestamp}), "comments" : comments},
      "$unset" : {"notUpdated" : true}})
});
