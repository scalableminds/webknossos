### define
backbone.marionette : Marionette
###

class SortTableBehavior extends Backbone.Marionette.Behavior

  events :
    "click thead" : "onClick"

  sortAttributes : {}

  lastSortAttribute : ""

  defaults :
    sortDirection : "asc"

  initialize : ->

    # disable auto-rerender after sorting
    # we will deal with this manually
    this.view.sort = false


  onDomRefresh : ->

    sortableTableHeads = $("[data-sort]").toArray()
    sortableTableHeads.forEach((tableHeader) =>
      $tableHeader = $(tableHeader)

      sortAttribute = $tableHeader.data().sort
      sortDirection = @sortAttributes[sortAttribute]
      sortIcon = if sortDirection then "fa-sort-#{sortDirection}" else "fa-sort"

      $tableHeader.append("<div class='sort-icon-wrapper'><span class='fa #{sortIcon} sort-icon'></span></div>")
      $tableHeader.addClass("sortable-column")
    )


  getSortDirection : (sortAttribute) ->

    toggleDirection = (direction) ->
      if direction == "desc" then "asc" else "desc"

    if @lastSortAttribute != sortAttribute
      @sortAttributes[@lastSortAttribute] = null
      @lastSortAttribute = sortAttribute
      sortDirection = @options.sortDirection
    else
      sortDirection = toggleDirection(@sortAttributes[sortAttribute])

    @sortAttributes[sortAttribute] = sortDirection
    return sortDirection


  sortTable : ($elem, sortAttribute) ->

    sortDirection = @getSortDirection(sortAttribute)
    this.view.collection.setSort(sortAttribute, sortDirection)
    this.view.resortView()


  onClick : (evt) ->

    $elem = if _.contains(evt.target.className, "sort-icon") then $(evt.target).closest("th") else $(evt.target)
    elemData = $elem.data()
    if "sort" not of elemData
      return
    else
      @sortTable($elem, elemData.sort)
