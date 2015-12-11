TeamModel = require("./team_model")
PaginationCollection = require("../pagination_collection")


class PaginatedTeamCollection extends PaginationCollection

  url : "/api/teams"
  model: TeamModel

module.exports = PaginatedTeamCollection
