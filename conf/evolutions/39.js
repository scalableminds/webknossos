// Turn annotation flags into an enum

// --- !Ups
db.annotations.find().forEach(function(elem) {
  let newState = ""
  if(elem.state.isFinished) newState = "Finished"
    else if(elem.state.isInProgress) newState = "Progress"
    else if (elem.state.isAssigned) newState = "Assigned"
    else newState = "Unassigned"

  elem.state = newState
  db.annotations.save(elem);
});

// --- !Downs
db.annotations.find().forEach(function(elem) {
  let isAssigned = false
  let isFinished = false
  let isInProgress = false
  if(elem.state == "Finished") {
    isAssigned = true
    isFinished = true
  }
  if(elem.state == "Progress"){
    isInProgress = true
    isAssigned = true
  }
  if(elem.state == "Assigned"){
    isAssigned = true
  }
  elem.state = {"isAssigned": isAssigned, "isInProgress": isInProgress, "isFinished": isFinished}

  db.annotations.save(elem);
});
