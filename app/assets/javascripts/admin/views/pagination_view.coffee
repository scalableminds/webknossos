_          = require("lodash")
app        = require("app")
Marionette = require("backbone.marionette")

class PaginationView extends Marionette.View

  paginatorTemplate : _.template("""
    <li class="first <% if (Pagination.currentPage == 0) { %> disabled <% } %>">
      <a><i class="fa fa-angle-double-left"></i></a>
    </li>
    <li class="prev <% if (Pagination.currentPage == 0) { %> disabled <% } %>"">
      <a><i class="fa fa-angle-left"></i></a>
    </li>
    <% _.each(pageRange, function (pageIndex) { %>
      <% if (Pagination.currentPage == pageIndex) { %>
        <li class="active">
          <span><%- pageIndex + 1 %></span>
        </li>
      <% } else { %>
        <li>
          <a class="page"><%- pageIndex + 1 %></a>
        </li>
      <% } %>
    <% }); %>
    <li class="next <% if (Pagination.currentPage >= Pagination.lastPage) { %> disabled <% } %>">
      <a><i class="fa fa-angle-right"></i></a>
    </li>
    <li class="last <% if (Pagination.currentPage >= Pagination.lastPage) { %> disabled <% } %>">
      <a><i class="fa fa-angle-double-right"></i></a>
    </li>
  """)
  template : _.template("""
    <div class="row">
      <div class="col-sm-9">
        <ul class="pagination">

        </ul>

        <% if (addButtonText) { %>
          <a class="btn btn-primary add-button" href="#">
            <i class="fa fa-plus"></i><%- addButtonText %>
          </a>
        <% } %>
      </div>
      <div class="col-sm-3">
        <div class="input-group search-container">
          <input type="search" class="form-control search-query" placeholder="Search" value="">
          <span class="input-group-addon"><i class="fa fa-search"></i></span>
        </div>
      </div>
    </div>
  """)

  className : "container wide"

  templateContext : ->
    paginationInfo = @collection.getPaginationInfo()
    pageRange : _.range(
      Math.max(paginationInfo.firstPage, paginationInfo.currentPage - 4),
      Math.min(paginationInfo.lastPage, paginationInfo.currentPage + 4) + 1)
    Pagination : paginationInfo
    addButtonText : @options.addButtonText

  ui :
    "inputSearch" : ".search-query"

  events :
    "click .prev" : "goBack"
    "click .next" : "goNext"
    "click .last" : "goLast"
    "click .first" : "goFirst"
    "click .page" : "handleClickPage"
    "click .add-button" : "addElement"
    "input input" : "filterBySearch"


  initialize : (options) ->

    @options = options
    @listenToOnce(@collection, "reset", @searchByHash)
    @listenTo(@collection, "reset", @render)


  goFirst : (evt) ->

    evt?.preventDefault()
    @collection.getFirstPage()

  goLast : (evt) ->

    evt?.preventDefault()
    @collection.getLastPage()

  goBack : (evt) ->

    evt?.preventDefault()
    @collection.getPreviousPage()

  goNext : (evt) ->

    evt?.preventDefault()
    @collection.getNextPage()


  handleClickPage : (evt) ->

    evt?.preventDefault()
    page = $(evt.target).text()
    @collection.getPage(parseInt(page) - 1)

  goToPage : (page) ->

    @collection.getPage(page)


  addElement : ->

    app.vent.trigger("paginationView:addElement")


  filterBySearch : ->

    # implement actually filtering on the collection in each respective view
    # in order to set correct fields for filtering
    filterQuery = @ui.inputSearch.val()
    app.vent.trigger("paginationView:filter", filterQuery)


  render : ->

    this._ensureViewIsIntact()
    this.triggerMethod('before:render', this)

    obj = @templateContext()
    if not this._isRendered
      @$el.html(@template(obj))
    this._isRendered = true

    @$el.find("ul.pagination").html(@paginatorTemplate(obj))
    this.bindUIElements()
    this.triggerMethod('render', this)
    return this


  searchByHash : ->

    hash = location.hash.slice(1)
    if (hash)
      @ui.inputSearch.val(hash)
      @ui.inputSearch.focus()
      @filterBySearch()


module.exports = PaginationView
