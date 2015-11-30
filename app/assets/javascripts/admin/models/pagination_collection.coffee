### define
underscore : _
backbone.paginator : Paginator
###

# A helper class to wrap the Backbone.Paginator lib and set some sensible
# defaults
#
# Make sure to always call fetch() with the option 'silent: true' and use
# strings instead of objects for the 'data' option.
# If you create a new PaginationCollection without 'fetching' from the server
# call the 'bootstrap()' method.

class PaginationCollection extends Backbone.Paginator.clientPager

  ##  pagination attributes  ##

  paginator_core :
    url : ->
      return this.url #use url from each individual collection
    type : "GET"
    dataType : "json"
    cache : true

  paginator_ui :
    firstPage : 1
    currentPage : 1
    perPage : 10
    pagesInRange : 4


  server_api = {}


  ##  pagination methods  ##

  parse : (response) ->

    this.totalPages = Math.ceil(response.length / @perPage)
    return response;


  lastPage : ->

    lastPage = @info().totalPages
    @goTo(lastPage)


  firstPage : ->

    @goTo(1)


  ##  collection methods  ##

  sortByAttribute: (attribute) ->
    @setSort(@sortAttribute, @sortDirection)
