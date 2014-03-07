### define
underscore : _
../pagination_collection : PaginationCollection
###

class TaskCollection extends PaginationCollection

  url : "/api/tasks"

  parse : (respones) ->

    # apply some defaults
    _.map(respones,
      (response) ->

        response.type =
          summary : response.type?.summary || "deleted"

        return response
    )