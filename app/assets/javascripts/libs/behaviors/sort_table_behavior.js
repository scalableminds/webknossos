import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";

class SortTableBehavior extends Marionette.Behavior {
  static initClass() {

    this.prototype.events  =
      {"click thead" : "onClick"};

    this.prototype.sortAttributes  = {};

    this.prototype.lastSortAttribute  = "";

    this.prototype.defaults  =
      {sortDirection : "asc"};
  }


  onRender() {

    const sortableTableHeads = this.$("[data-sort]").toArray();
    return sortableTableHeads.forEach(tableHeader => {
      const $tableHeader = $(tableHeader);

      const sortAttribute = $tableHeader.data().sort;
      const sortDirection = this.sortAttributes[sortAttribute];
      const sortIcon = sortDirection ? `fa-sort-${sortDirection}` : "fa-sort";

      $tableHeader.append(`<div class='sort-icon-wrapper'><span class='fa ${sortIcon} sort-icon'></span></div>`);
      return $tableHeader.addClass("sortable-column");
    }
    );
  }


  getSortDirection(sortAttribute) {

    let sortDirection;
    const toggleDirection = function(direction) {
      if (direction === "desc") { return "asc"; } else { return "desc"; }
    };

    if (this.lastSortAttribute !== sortAttribute) {
      this.sortAttributes[this.lastSortAttribute] = null;
      this.lastSortAttribute = sortAttribute;
      ({ sortDirection } = this.options);
    } else {
      sortDirection = toggleDirection(this.sortAttributes[sortAttribute]);
    }

    this.sortAttributes[sortAttribute] = sortDirection;
    return sortDirection;
  }


  sortTable($elem, sortAttribute) {

    const sortDirection = this.getSortDirection(sortAttribute);
    this.view.collection.setSort(sortAttribute, sortDirection);
    return this.view.resortView();
  }


  onClick(evt) {

    const $elem = _.includes(evt.target.className, "sort-icon") ? $(evt.target).closest("th") : $(evt.target);
    const elemData = $elem.data();
    if (!("sort" in elemData)) {
      return;
    } else {
      return this.sortTable($elem, elemData.sort);
    }
  }
}
SortTableBehavior.initClass();

export default SortTableBehavior;
