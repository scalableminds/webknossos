import _ from "lodash";
import $ from "jquery";
import app from "app";
import Marionette from "backbone.marionette";

class PaginationView extends Marionette.View {
  static initClass() {
    this.prototype.paginatorTemplate = _.template(`\
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
</li>\
`);
    this.prototype.template = _.template(`\
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
</div>\
`);

    this.prototype.className = "container wide";

    this.prototype.ui =
      { inputSearch: ".search-query" };

    this.prototype.events = {
      "click .prev": "goBack",
      "click .next": "goNext",
      "click .last": "goLast",
      "click .first": "goFirst",
      "click .page": "handleClickPage",
      "click .add-button": "addElement",
      "input input": "filterBySearch",
    };
  }

  templateContext() {
    const paginationInfo = this.collection.getPaginationInfo();
    return {
      pageRange: _.range(
        Math.max(paginationInfo.firstPage, paginationInfo.currentPage - 4),
        Math.min(paginationInfo.lastPage, paginationInfo.currentPage + 4) + 1),
      Pagination: paginationInfo,
      addButtonText: this.options.addButtonText,
    };
  }


  initialize(options) {
    this.options = options;
    this.listenToOnce(this.collection, "reset", this.searchByHash);
    return this.listenTo(this.collection, "reset", this.render);
  }


  goFirst(evt) {
    __guard__(evt, x => x.preventDefault());
    return this.collection.getFirstPage();
  }

  goLast(evt) {
    __guard__(evt, x => x.preventDefault());
    return this.collection.getLastPage();
  }

  goBack(evt) {
    __guard__(evt, x => x.preventDefault());
    return this.collection.getPreviousPage();
  }

  goNext(evt) {
    __guard__(evt, x => x.preventDefault());
    return this.collection.getNextPage();
  }


  handleClickPage(evt) {
    __guard__(evt, x => x.preventDefault());
    const page = $(evt.target).text();
    return this.collection.getPage(parseInt(page) - 1);
  }

  goToPage(page) {
    return this.collection.getPage(page);
  }


  addElement() {
    return app.vent.trigger("paginationView:addElement");
  }


  filterBySearch() {
    // implement actually filtering on the collection in each respective view
    // in order to set correct fields for filtering
    const filterQuery = this.ui.inputSearch.val();
    return app.vent.trigger("paginationView:filter", filterQuery);
  }


  render() {
    /* eslint-disable no-underscore-dangle */
    this._ensureViewIsIntact();
    this.triggerMethod("before:render", this);

    const obj = this.templateContext();
    if (!this._isRendered) {
      this.$el.html(this.template(obj));
    }
    this._isRendered = true;
    /* eslint-enable no-underscore-dangle */

    this.$el.find("ul.pagination").html(this.paginatorTemplate(obj));
    this.bindUIElements();
    this.triggerMethod("render", this);
    return this;
  }


  searchByHash() {
    const hash = location.hash.slice(1);
    if (hash) {
      this.ui.inputSearch.val(hash);
      this.ui.inputSearch.focus();
      return this.filterBySearch();
    }
  }
}
PaginationView.initClass();


export default PaginationView;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
