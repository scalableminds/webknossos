_                    = require("lodash")
Backbone             = require("backbone")
TeamModel            = require("./team_model")
PaginationCollection = require("../pagination_collection")

class TeamCollection extends Backbone.Collection

  url : "/api/teams"
  model: TeamModel

module.exports = TeamCollection
