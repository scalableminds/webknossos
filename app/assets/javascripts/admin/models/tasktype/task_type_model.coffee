_           = require("lodash")
FormatUtils = require("libs/format_utils")

class TaskTypeModel extends Backbone.Model

  urlRoot : "/api/taskTypes"

  defaults :
    summary : ""
    description : ""
    settings :
      allowedModes : ["flight", "orthogonal", "oblique"]
      branchPointsAllowed : true
      advancedOptionsAllowed : true
      somaClickingAllowed : true
      preferredMode : ""
    expectedTime :
      min : 300
      max : 600
      maxHard : 900


  parse : (response) ->

    response.formattedHash = FormatUtils.formatHash(response.id)
    response.formattedShortText = FormatUtils.formatShortText(response.description)

    return response


  destroy : ->

    options = url : "/api/taskTypes/#{@get('id')}"
    super(options)

module.exports = TaskTypeModel
