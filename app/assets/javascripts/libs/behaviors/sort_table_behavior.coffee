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

  onShow: () ->
    sortableTableHeads = $("[data-sort]").toArray()
    sortableTableHeads.forEach((tableHeader) =>
      $tableHeader = $(tableHeader)
      @sortAttributes[$tableHeader.data().sort] = @options.sortDirection
      $tableHeader.append("<div class='sort-icon-wrapper'></div>")
      $tableHeader.addClass("sortable-column")
    )


  getSortDirection: (sortAttribute) ->

    toggleDirection = (direction) ->
      if direction == "desc" then "asc" else "desc"

    if @lastSortAttribute != sortAttribute
      @resetSorting
      @lastSortAttribute = sortAttribute
      sortDirection = @options.sortDirection
    else
      sortDirection = toggleDirection(@sortAttributes[sortAttribute])

    @sortAttributes[sortAttribute] = sortDirection
    return sortDirection


  removeSortIcon: () ->
    $("thead").find(".sort-icon").remove()


  changeSortIcon: ($elem, sortDirection) ->
    iconHtml = "<span class='fa fa-sort-#{sortDirection} sort-icon'></span>"
    @removeSortIcon()
    $elem.find("div").append(iconHtml)


  resetSorting: () ->
    @sortAttributes[@lastSortAttribute] = @options.sortDirection
    @removeSortIcon()


  sortTable: ($elem, sortAttribute) ->
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
