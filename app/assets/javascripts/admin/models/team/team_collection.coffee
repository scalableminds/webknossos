### define
underscore : _
backbone : Backbone
./team_model : TeamModel
###

class TeamCollection extends Backbone.Collection

  url : "/api/teams"
  model: TeamModel
