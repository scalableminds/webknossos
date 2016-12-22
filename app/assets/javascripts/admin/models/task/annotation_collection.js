_               = require("lodash")
backbone        = require("backbone")
AnnotationModel = require("./annotation_model")
FormatUtils     = require("libs/format_utils")

class AnnotationCollection extends Backbone.Collection

  model : AnnotationModel

  constructor : (taskId) ->

    @url = "/api/tasks/#{taskId}/annotations"
    super()

  parse : (responses) ->

    return responses.map((response) ->

      response.tracingTime ?= 0
      response.formattedTracingTime = FormatUtils.formatSeconds(response.tracingTime / 1000)

      return response
    )

module.exports = AnnotationCollection
