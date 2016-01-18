_                    = require("lodash")
PaginationCollection = require("../pagination_collection")
FormatUtils          = require("format_utils")

class TaskCollection extends PaginationCollection

  initialize : (models, options = {}) ->

    @taskTypeId = options.taskTypeId
    @dataSetName = options.dataSetName


  url : ->
    if @taskTypeId
      "/api/taskTypes/#{@taskTypeId}/tasks"
    else
      "/api/tasks"


  parse : (responses) ->

    responses = responses.map((response) ->
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

    if @dataSetName
      return _.filter(responses, dataSet : @dataSetName)
    else
      return responses


module.exports = TaskCollection
