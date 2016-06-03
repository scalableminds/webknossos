_                    = require("lodash")
TeamModel            = require("./team_model")
SortedCollection     = require("../sorted_collection")

class TeamCollection extends SortedCollection

  url : "/api/teams"
  model : TeamModel
  sortAttribute : "name"

module.exports = TeamCollection
