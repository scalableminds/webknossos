import Backbone from "backbone";

class SortedCollection extends Backbone.Collection {

  initialize() {

    if (this.sortAttribute) {
      return this.setSort(this.sortAttribute, "asc");
    }
  }


  setSort(field, sortDirection) {

    if (sortDirection === "asc") {
      sortDirection = 1;
    }
    if (sortDirection === "desc") {
      sortDirection = -1;
    }

    // Set your comparator function, pass the field.
    this.comparator = function(left, right) {
      const leftValue  = left.get(field);
      const rightValue = right.get(field);
      return _.isString(leftValue) && _.isString(rightValue) ?
          sortDirection > 0 ?
            leftValue.localeCompare(rightValue)
          :
            rightValue.localeCompare(leftValue)
        :
          sortDirection > 0 ?
            leftValue - rightValue
          :
            rightValue - leftValue;
    };

    return this.sort();
  }
}


export default SortedCollection;
