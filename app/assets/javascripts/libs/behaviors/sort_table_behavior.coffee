### define
backbone.marionette : Marionette
###

class SortTableBehavior extends Backbone.Marionette.Behavior

  events:
    "click thead": "onClick"

  sortAttributes: {}

  lastSortAttribute: ""

  defaults:
    sortDirection: "asc"

  getSortDirection: (sortAttribute) ->

    toggleDirection = (direction) ->
      if direction == "desc" then "asc" else "desc"

    if sortAttribute of @sortAttributes
      sortDirection = toggleDirection(@sortAttributes[sortAttribute])
    else
      sortDirection = this.options.sortDirection

    @sortAttributes[sortAttribute] = sortDirection
    return sortDirection

  removeSortIcon: () ->
    $("thead").find(".sort-icon").remove()

  changeSortIcon: ($elem, sortDirection) ->
    iconHtml = "<span class='fa fa-sort-#{sortDirection} sort-icon'></span>"
    @removeSortIcon()
    $elem.append(iconHtml)

  sortTable: ($elem, sortAttribute) ->
    if @lastSortAttribute != sortAttribute
      delete @sortAttributes[sortAttribute]
      @removeSortIcon()

    @lastSortAttribute = sortAttribute
    sortDirection = @getSortDirection(sortAttribute)
    this.view.collection.setSort(sortAttribute, sortDirection)
    this.changeSortIcon($elem, sortDirection)

  onClick: (evt) ->
    $elem = $(evt.target)
    elemData = $elem.data()
    if "sort" not of elemData
      return
    else
      @sortTable($elem, elemData.sort)
