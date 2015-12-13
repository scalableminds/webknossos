_          = require("lodash")
app        = require("app")
marionette = require("backbone.marionette")

class PaginationView extends Backbone.Marionette.ItemView

  template : _.template("""
    <div class="row">
      <div class="col-sm-9">
        <ul class="pagination">
          <li class="first <% if (Pagination.currentPage == 1) { %> disabled <% } %>">
            <a><i class="fa fa-angle-double-left"></i></a>
          </li>
          <li class="prev <% if (Pagination.currentPage == 1) { %> disabled <% } %>"">
            <a><i class="fa fa-angle-left"></i></a>
          </li>
          <% if (Pagination.lastPage == 1){ %>
            <li class="active">
              <span>1</span>
            <li>
          <% } %>
          <% _.each(pageRange, function (p) { %>
            <% if (Pagination.currentPage == p) { %>
              <li class="active">
                <span><%= p %></span>
              </li>
            <% } else { %>
              <li>
                <a class="page"><%= p %></a>
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
            <i class="fa fa-plus"></i><%= addButtonText %>
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
    pageRange : _.range(
      Math.max(@collection.state.firstPage, @collection.state.currentPage - 5),
      Math.min(@collection.state.lastPage, @collection.state.currentPage + 5))
    Pagination : @collection.state
    addButtonText : @options.addButtonText

  ui :
    "inputSearch" : ".search-query"

  events :
    "click .prev" : "goBack"
    "click .next" : "goNext"
    "click .last" : "goLast"
    "click .first" : "goFirst"
    "click .page" : "goToPage"
    "click .add-button" : "addElement"
    "input input" : "filterBySearch"


  initialize : ->

    @listenTo(@collection, "add", @afterAdd)
    @listenToOnce(@collection, "reset", @searchByHash)


  goFirst : (evt) ->
    @collection.getFirstPage()

  goLast : (evt) ->
    @collection.getLastPage()

  goBack : (evt) ->
    pagination = @collection.state
    if pagination.currentPage > pagination.firstPage
      @collection.getPreviousPage()

  goNext : ->
    pagination = @collection.state
    if pagination.currentPage < pagination.lastPage
      @collection.getNextPage()


  goToPage : (evt) ->

    evt.preventDefault()
    page = $(evt.target).text()
    @collection.getPage(page)


  addElement : ->

    app.vent.trigger("paginationView:addElement")


  filterBySearch : ->

    # implement actually filtering on the collection in each respective view
    # in order to set correct fields for filtering
    filterQuery = @ui.inputSearch.val()
    app.vent.trigger("paginationView:filter", filterQuery)

    @ui.inputSearch.focus()
    @ui.inputSearch.val(filterQuery)


  afterAdd : ->

    @goLast()


  searchByHash : ->

    hash = location.hash.slice(1)
    if (hash)
      @ui.inputSearch.val(hash)
      @filterBySearch()


module.exports = PaginationView
