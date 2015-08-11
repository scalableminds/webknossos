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

  onDomRefresh: ->
    sortableTableHeads = $("[data-sort]").toArray()
    sortableTableHeads.forEach((tableHeader) =>
      $tableHeader = $(tableHeader)
      @sortAttributes[$tableHeader.data().sort] = @options.sortDirection
      $tableHeader.append("<div class='sort-icon-wrapper'><span class='fa fa-sort sort-icon'></span></div>")
      $tableHeader.addClass("sortable-column")
    )


  getSortDirection: (sortAttribute) ->

    toggleDirection = (direction) ->
      if direction == "desc" then "asc" else "desc"

    if @lastSortAttribute != sortAttribute
      @resetSorting()
      @lastSortAttribute = sortAttribute
      sortDirection = @options.sortDirection
    else
      sortDirection = toggleDirection(@sortAttributes[sortAttribute])

    @sortAttributes[sortAttribute] = sortDirection
    return sortDirection


  resetSortIcon: (elem) ->
    $(elem).find(".sort-icon").alterClass("fa-sort-*", "fa-sort")


  changeSortIcon: ($elem, sortDirection) ->
    $elem.find(".sort-icon").alterClass("fa-sort*", "fa-sort-#{sortDirection}")


  resetSorting: ->
    @sortAttributes[@lastSortAttribute] = @options.sortDirection
    $(".sortable-column").each((index, elem) => @resetSortIcon(elem))


  sortTable: ($elem, sortAttribute) ->
    sortDirection = @getSortDirection(sortAttribute)
    this.view.collection.setSort(sortAttribute, sortDirection)
    this.changeSortIcon($elem, sortDirection)


  onClick: (evt) ->

    $elem = if _.contains(evt.target.className, "sort-icon") then $(evt.target).closest("th") else $(evt.target)
    elemData = $elem.data()
    if "sort" not of elemData
      return
    else
      @sortTable($elem, elemData.sort)
