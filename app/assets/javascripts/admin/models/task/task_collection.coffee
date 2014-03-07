### define
underscore : _
../pagination_collection : PaginationCollection
###

class TaskCollection extends PaginationCollection

  url : "/api/tasks"

  parse : (respones) ->

    _.map(respones,
      (response) ->

        # apply some defaults
        response.type =
          summary : response.type?.summary || "deleted"

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
