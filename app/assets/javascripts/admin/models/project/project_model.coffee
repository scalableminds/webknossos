_        = require("lodash")
backbone = require("backbone")

class ProjectModel extends Backbone.Model

  urlRoot : "/api/projects"
  idAttribute: "name"

  default :
    owner :
      firstName : ""
      lastName : ""
    priority: 100

  parse : (response)->

    # set some sensible defaults
    response.owner ||= @default.owner
    return response

module.exports = ProjectModel
