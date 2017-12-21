// Turn annotation flags into an enum

// --- !Ups
db.annotations.find().forEach(function(elem) {
  elem.oldState = elem.state;
  let newState = ""
  if(elem.state.isFinished) newState = "Finished"
    else if(elem.state.isInProgress) newState = "InProgress"
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
  if(elem.state == "InProgress"){
    isInProgress = true
    isAssigned = true
  }
  if(elem.state == "Assigned"){
    isAssigned = true
  }

  elem.state = {"isAssigned": isAssigned, "isInProgress": isInProgress, "isFinished": isFinished}

  //in case there is an "oldState"
  if(elem.oldState){
    elem.state = elem.oldState
    delete elem.oldState
  }

  db.annotations.save(elem);
});
