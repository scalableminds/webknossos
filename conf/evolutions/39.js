// Turn annotation flags into an enum

// --- !Ups
db.annotations.find().forEach(function(elem) {
  let newState = ""
  if(elem.state.isFinished) newState = "FINISHED"
    else if(elem.state.isInProgress) newState = "PROGRESS"
    else if (elem.state.isAssigned) newState = "ASSIGNED"
    else newState = "UNASSIGNED"

  elem.state = newState
  db.annotations.save(elem);
});

// --- !Downs
db.annotations.find().forEach(function(elem) {
  let isAssigned = false
  let isFinished = false
  let isInProgress = false
  if(elem.state == "FINISHED") {
    isAssigned = true
    isFinished = true
  }
  if(elem.state == "PROGRESS"){
    isInProgress = true
    isAssigned = true
  }
  if(elem.state == "ASSIGNED"){
    isAssigned = true
  }
  elem.state = {"isAssigned": isAssigned, "isInProgress": isInProgress, "isFinished": isFinished}

  db.annotations.save(elem);
});
