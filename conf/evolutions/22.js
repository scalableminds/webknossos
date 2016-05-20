// --- !Ups
var scmboy = db.users.find({"email" : "scmboy@scalableminds.com"})
var teamCursor = db.teams.find({"parent" : {"$exists" : false}})
if(scmboy.hasNext() && teamCursor.hasNext()) {
  db.projects.insert({
    "_owner": scmboy.next()._id,
    "name": "orphaned-tasks",
    "team": teamCursor.next().name
  })
  db.tasks.update({"_project": {$exists: false}}, {$set: {"_project": "orphaned-tasks"}}, {multi: true})
} else {
  throw new Error("Scmboy not found")
}

// --- !Downs
db.tasks.update({"_project": "orphaned-tasks"}, {$unset: {"_project": true}}, {multi: true})

db.projects.remove({"name" : "orphaned-tasks"})
