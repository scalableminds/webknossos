// Update to support teams

// --- !Ups
db.annotations.update({}, {"$set": { "team" : "Structure of Neocortical Circuits Group"} })

db.assertions.drop()

db.dataSets.drop()

db.projects.update({}, {"$set": { "team" : "Structure of Neocortical Circuits Group"} })

db.tasks.update({}, {"$set": { "team" : "Structure of Neocortical Circuits Group"} })

db.taskTypes.update({}, {"$set": { "team" : "Structure of Neocortical Circuits Group"} })

db.teams.drop()

db.teams.insert({"name" : "Structure of Neocortical Circuits Group", "roles" : [{"name" : "admin"}, {"name" : "user"}]})
db.teams.insert({"name" : "005", "roles" : [{"name" : "admin"}, {"name" : "user"}]})

db.users.find().forEach(function (user) {
  var oldTeams = user.teams;
  print(user.teams)
  var role = (user.roles.indexOf("admin") != -1) ? {"name" : "admin"} : {"name" : "user"}
  var newTeams = oldTeams.map(function (el){
    var team = el.teamPath.elements[el.teamPath.elements.length-1]
    return {"team" : team, "role" : role}
  });

  db.users.update({"_id" : user._id}, {
    "$set" : {
      "teams" : newTeams,
    }, 
    "$unset" : { 
      "roles" : ""
    }})
})

// --- !Downs
db.users.drop()

db.teams.drop()