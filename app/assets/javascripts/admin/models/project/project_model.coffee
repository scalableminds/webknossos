_        = require("lodash")
backbone = require("backbone")

class ProjectModel extends Backbone.Model

  urlRoot : "/api/projects"

  default :
    owner :
      firstName : ""
      lastName : ""
    priority: 100

  parse : (response)->

    # set some sensible defaults
    response.owner ||= @default.owner
    return response


  destroy : (options) ->

    _.extend(options, {url : "/api/projects/#{@get("name")}"})
    super(options)

module.exports = ProjectModel
