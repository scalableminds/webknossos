_                     = require("lodash")
FormatUtils           = require("libs/format_utils")
PaginationCollection  = require("../pagination_collection")

class ProjectTaskCollection extends PaginationCollection


  initialize : (models, options) ->

    @projectName = options.projectName

    # TODO on dev merge:
    # Use url() method directly. This Hack is due to weird lib Paginator behavior.
    @url = "/api/projects/#{@projectName}/tasks"

  parse : (responses) ->

    return _.map(responses,
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

module.exports = ProjectTaskCollection
