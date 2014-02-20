### define
underscore : _
backbone.paginator : Paginator
###

class PaginationCollection extends Backbone.Paginator.clientPager

  paginator_core :
    url : ->
      return this.url #use url from each individual collection
    type : "GET"
    dataType : "json"

  paginator_ui :
    firstPage : 1
    currentPage : 1
    perPage : 3
    totalPages : 10
    pagesInRange : 4


  parse : (response) ->

    this.totalPages = Math.ceil(response.length / @perPage)
    return response;
