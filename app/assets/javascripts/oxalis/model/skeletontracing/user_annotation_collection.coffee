_                    = require("lodash")
Backbone             = require("backbone")
PaginationCollection = require("admin/models/pagination_collection")

class UserAnnotationCollection extends PaginationCollection

  constructor : (userId) ->

    super()

    # We cannot use @url as a method since the Backbone.Paginator.clientPager
    # ignores the context which is necessary to read forTaskTypeID.
    # TODO: Check if this is still an issue with a newer version of backbone.paginator.
    @url = "/api/users/#{userId.id}/annotations"


  parse : (respones) ->

    return respones.exploratoryAnnotations

module.exports = UserAnnotationCollection
