FormatUtils           = require("libs/format_utils")
PaginationCollection  = require("../pagination_collection")
TaskModel             = require("./task_model")

class TaskCollection extends PaginationCollection

  model: TaskModel
  initialize : (models, options) ->

    @projectName = options.projectName
    @taskTypeId = options.taskTypeId

    unless @projectName or @taskTypeId
      throw new Error("TaskCollection initialized without 'project name' or 'task type id'")

    # Since the TaskCollection is shared between projects and taskTypes it is
    # handy to have a quick check available.
    @isForProject = @projectName?


  url : ->

    if @isForProject
      return "/api/projects/#{@projectName}/tasks"
    else
      return "/api/taskTypes/#{@taskTypeId}/tasks"


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

module.exports = TaskCollection
