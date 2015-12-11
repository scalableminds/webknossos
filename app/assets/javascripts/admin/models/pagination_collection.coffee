_                  = require("lodash")
PageableCollection = require("backbone.paginator")
Backbone           = require("backbone")

class PaginationCollection extends PageableCollection

  mode: 'client'

  ##  pagination attributes  ##

  state :
    firstPage : 1
    currentPage : 1
    pageSize : 10


  ##  collection methods  ##

  clearFilter : ->

    if @allModels
      @fullCollection.reset(@allModels)
      @allModels = null
    return


  setFilter : (fields, filter) ->

    if filter == '' or not _.isString(filter)
      @clearFilter()
      return

    words = _.map(filter.match(/\w+/ig), (element) -> element.toLowerCase())
    pattern = "(" + _.uniq(words).join("|") + ")"
    regexp = new RegExp(pattern, "igm")

    if not @allModels
      @allModels = @fullCollection.models.slice()

    @fullCollection.reset(@allModels.filter((item) ->
      _.any(fields, (fieldName) ->
        value = item.get(fieldName)
        return if value? then regexp.test(value) else false
      )
    ))
    return



  fetch : (args...) ->
    @fullCollection.fetch(args...)
      .then( => @trigger("sync"); return)

module.exports = PaginationCollection
