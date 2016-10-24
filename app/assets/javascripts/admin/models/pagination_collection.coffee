_                  = require("lodash")
Backbone           = require("backbone")

class PaginationCollection

  constructor : (models, options) ->

    _.extend(this, Backbone.Events)

    if options?.fullCollection
      @fullCollection = options.fullCollection
    else
      @fullCollection = new Backbone.Collection(models, options)
      if @initialize
        @initialize.call(@fullCollection, models, options)

    if @model?
      @fullCollection.model = @model
    if @url?
      @fullCollection.url   = @url
    if @parse?
      @fullCollection.parse = @parse
    if @idAttribute?
      @fullCollection.idAttribute = @idAttribute

    @currentModels = @fullCollection.models.slice()
    @state = _.defaults(_.clone(@state) ? {},
      pageSize : 10
      currentPage : 0
      sorting : null
      filter : null
      collectionFilter : null
      filterQuery : ""
    )

    if @sortAttribute
      @setSort(@sortAttribute, "asc")

    @length = Math.min(@state.pageSize, @fullCollection.length)
    @models = @currentModels.slice(0, @length)

    @listenTo(@fullCollection, "reset", @_reset)
    @listenTo(@fullCollection, "add", @_passthroughEvent("add"))
    @listenTo(@fullCollection, "remove", @_passthroughEvent("remove"))
    @listenTo(@fullCollection, "sync", @_passthroughEvent("sync"))

    @_reset = _.debounce(@_resetNow, 50)
    return


  add : ->
    @fullCollection.add.apply(@fullCollection, arguments)

  remove : ->
    @fullCollection.remove.apply(@fullCollection, arguments)

  set : ->
    @fullCollection.set.apply(@fullCollection, arguments)

  fetch : ->
    @fullCollection.fetch.apply(@fullCollection, arguments)

  create : ->
    @fullCollection.create.apply(@fullCollection, arguments)

  reset : ->
    @fullCollection.reset.apply(@fullCollection, arguments)


  setPageSize : (pageSize) ->
    @state.pageSize = pageSize
    @_resetNow()
    return


  setSorting : (field, order) ->
    @setSort(field, order)
    return


  setSort : (field, order) ->

    if order == "asc"
      order = 1
    if order == "desc"
      order = -1

    @state.sorting = (left, right) ->
      leftValue  = left.get(field)
      rightValue = right.get(field)
      return if _.isString(leftValue) && _.isString(rightValue)
          if order > 0
            leftValue.localeCompare(rightValue)
          else
            rightValue.localeCompare(leftValue)
        else
          if order > 0
            leftValue - rightValue
          else
            rightValue - leftValue

    @_reset()
    return


  setCollectionFilter : (filter) ->

    @state.collectionFilter = filter
    return


  setFilter : (fields, query) ->

    if query == '' or not _.isString(query)
      @state.filterQuery = ""
      @state.filter = null
    else
      words = _.map(query.split(" "),
        (element) -> element.toLowerCase().replace(/[\-\[\]{}()\*\+\?\.,\\\^\$\|\#\s]/g, "\\$&"))
      uniques = _.filter(_.uniq(words), (element) -> element != '')
      pattern = "(" + uniques.join("|") + ")"
      regexp = new RegExp(pattern, "igm")

      @state.filterQuery = query
      @state.filter = (model) ->
        return _.some(fields, (fieldName) ->
          value = model.get(fieldName)
          if value?
            return !!value.toString().match(regexp)
          else
            return false
        )

    @_reset()
    return


  at : (index) ->
    return @currentModels[index]

  get : (index) ->
    return @at(index)

  clone : ->
    clonedCollection = new PaginationCollection(null, {
      fullCollection : @fullCollection
    })
    clonedCollection.setPageSize(@state.pageSize)
    return clonedCollection

  map : (args...) ->
    return _.map(@models, args...)

  _lastPageIndex : ->
    return Math.ceil(@currentModels.length / @state.pageSize) - 1

  _passthroughEvent : (eventType) ->
    return (args...) ->
      if eventType == "sync"
        @_resetNow()
      else
        @_reset()
      @trigger(eventType, args...)
      return

  _resetModels : ->
    models = @fullCollection.models.slice()

    if @state.collectionFilter?
      models = models.filter(@state.collectionFilter)

    if @state.filter?
      models = models.filter(@state.filter)

    if @state.sorting?
      models = models.sort(@state.sorting)

    @currentModels = models
    @state.currentPage = Math.max(0, Math.min(
      @_lastPageIndex(),
      @state.currentPage))

    return


  _resetNow : ->
    @_resetModels()
    @models = @currentModels.slice(
      @state.currentPage * @state.pageSize,
      Math.min(
        (@state.currentPage + 1) * @state.pageSize,
        @currentModels.length))

    @length = @models.length
    @trigger("reset")
    return


  getPaginationInfo : ->
    return {
      firstPage : 0
      lastPage : @_lastPageIndex()
      currentPage : @state.currentPage
      pageSize : @state.pageSize
    }


  getPreviousPage : ->
    @getPage(@state.currentPage - 1)
    return


  getNextPage : ->
    @getPage(@state.currentPage + 1)
    return


  getFirstPage : ->
    @getPage(0)
    return


  getLastPage : ->
    @getPage(@_lastPageIndex())
    return


  getPage : (pageIndex) ->
    if 0 <= pageIndex < Math.ceil(@currentModels.length / @state.pageSize)
      @state.currentPage = pageIndex
      @_reset()
    return

  toJSON : ->
    @models.map((model) -> model.toJSON())


  findWhere : ->

    return @fullCollection.findWhere.apply(@fullCollection, arguments)


module.exports = PaginationCollection
