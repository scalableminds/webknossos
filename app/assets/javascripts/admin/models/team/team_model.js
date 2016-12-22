_        = require("lodash")
Backbone = require("backbone")

class TeamModel extends Backbone.Model

  urlRoot : "/api/teams"

  defaults :
    name : ""
    owner : ""
    roles : [
        {name : "admin"},
        {name : "user"}
    ]
    isEditable : "true"

module.exports = TeamModel
