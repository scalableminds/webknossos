_                    = require("underscore")
Backbone             = require("backbone")
TeamModel            = require("./team_model")
PaginationCollection = require("../pagination_collection")

class TeamCollection extends PaginationCollection

  url : "/api/teams"
  model: TeamModel

module.exports = TeamCollection
