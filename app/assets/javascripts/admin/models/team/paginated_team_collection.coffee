### define
underscore : _
backbone : Backbone
./team_model : TeamModel
../pagination_collection : PaginationCollection
###

class PaginatedTeamCollection extends PaginationCollection

  url : "/api/teams"
  model: TeamModel
