// --- !Ups
// should NOT be applied on master
db.teams.update({"name" : {"$ne" : "Structure of Neocortical Circuits Group"}}, {"$set" : {"parent" : "Structure of Neocortical Circuits Group"}}, {"multi" : true})

// --- !Downs
