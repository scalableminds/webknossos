_          = require("lodash")
app        = require("app")
Marionette = require("backbone.marionette")

class PaginationView extends Marionette.ItemView

  template : _.template("""
    <div class="row">
      <div class="col-sm-9">
        <ul class="pagination">
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
        </ul>

        <% if (addButtonText) { %>
          <a class="btn btn-success add-button" href="#">
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
  templateHelpers : ->
    paginationInfo = @collection.getPaginationInfo()
    pageRange : _.range(
      Math.max(paginationInfo.firstPage, paginationInfo.currentPage - 5),
      Math.min(paginationInfo.lastPage, paginationInfo.currentPage + 5) + 1)
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


  initialize : ->

    @listenToOnce(@collection, "reset", @searchByHash)
    @listenTo(@collection, "reset", @render)
    @listenTo(this, "render", @afterRender)


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

    @ui.inputSearch.focus()
    @ui.inputSearch.val(@collection.state.filterQuery)


  afterRender : ->

    @ui.inputSearch.val(@collection.state.filterQuery)


  searchByHash : ->

    hash = location.hash.slice(1)
    if (hash)
      @ui.inputSearch.val(hash)
      @filterBySearch()


module.exports = PaginationView
