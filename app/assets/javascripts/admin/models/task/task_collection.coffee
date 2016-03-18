### define
underscore : _
../pagination_collection : PaginationCollection
libs/format_utils : FormatUtils
###

class TaskCollection extends PaginationCollection

  constructor : (forTaskTypeID) ->

    super()

    # We cannot use @url as a method since the Backbone.Paginator.clientPager
    # ignores the context which is necessary to read forTaskTypeID.
    # TODO: Check if this is still an issue with a newer version of backbone.paginator.
    @url =
      if forTaskTypeID
        "/api/taskTypes/#{forTaskTypeID}/tasks"
      else
        "/api/tasks"


  parse : (responses) ->

    _.map(responses,
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
