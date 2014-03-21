### define
underscore : _
backbone : Backbone
###

class TeamModel extends Backbone.Model

  urlRoot : "/api/teams"
  
  defaults :
    name : ""
    owner : ""
    roles : [
        name : "admin"
        name : "user"
    ]
    isEditable : "true"
