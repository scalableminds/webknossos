_                    = require("lodash")
PaginationCollection = require("../pagination_collection")
FormatUtils          = require("format_utils")

class TaskCollection extends PaginationCollection

  initialize : (options = {}) ->

    @taskTypeId = options.taskTypeId


  url : ->
    if @taskTypeId
      "/api/taskTypes/#{@taskTypeId}/tasks"
    else
      "/api/tasks"


  parse : (respones) ->

    debugger
    return _.map(respones,
      (response) ->

        # apply some defaults
        response.type =
          summary : response.type?.summary || "<deleted>"
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
