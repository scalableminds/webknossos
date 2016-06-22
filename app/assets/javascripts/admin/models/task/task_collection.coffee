FormatUtils           = require("libs/format_utils")
Backbone              = require("backbone")
TaskModel             = require("./task_model")

class TaskCollection extends Backbone.Collection

  model: TaskModel
  initialize : (models, options={}) ->

    @projectName = options.projectName
    @taskTypeId = options.taskTypeId

  url : ->
    if @projectName?
      return "/api/projects/#{@projectName}/tasks"
    else if @taskTypeId?
      return "/api/taskTypes/#{@taskTypeId}/tasks"
    else
      return "/api/queries"

  parse : (responses) ->

    return responses.map((response) ->

      # apply some defaults
      response.type =
        summary : response.type?.summary || "<deleted>"
        id: response.type?.id || ""

      response.formattedTracingTime = FormatUtils.formatSeconds(response.tracingTime? or 0)

      # convert bounding box
      if response.boundingBox?

        { topLeft, width, height, depth } = response.boundingBox
        response.boundingBox = topLeft.concat [
          topLeft[0] + width
          topLeft[1] + height
          topLeft[2] + depth
        ]

      else
        response.boundingBox = []

      return response
    )

  addObjects : (objects) ->

    @add(@parse(objects))

module.exports = TaskCollection
