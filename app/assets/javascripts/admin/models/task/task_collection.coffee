### define
underscore : _
../pagination_collection : PaginationCollection
###

class TaskCollection extends PaginationCollection

  url : "/api/tasks"

  parse : (response) ->

    for task in response
      if task.boundingBox?

        { topLeft, width, height, depth } = task.boundingBox
        task.boundingBox = topLeft.concat [
          topLeft[0] + width
          topLeft[1] + height
          topLeft[2] + depth
        ]

      else
        task.boundingBox = []


    return response
