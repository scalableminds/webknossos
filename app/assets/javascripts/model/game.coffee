### define
libs/request : Request
###

# This holds game specific data.

Game = 
  
  dataSet : null

  initialize : -> 
    
    Request.send(
      url : "/game/initialize"
      responseType : "json"
    ).pipe (task) =>
      _.extend(this, task)
      return
