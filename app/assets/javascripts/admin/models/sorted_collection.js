/**
 * sorted_collection.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";

class SortedCollection extends Backbone.Collection {
  initialize() {
    if (this.sortAttribute) {
      this.setSort(this.sortAttribute, "asc");
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
      const leftValue = left.get(field);
      const rightValue = right.get(field);
      let compValue;
      if (_.isString(leftValue) && _.isString(rightValue)) {
        if (sortDirection > 0) {
          compValue = leftValue.localeCompare(rightValue);
        } else {
          compValue = rightValue.localeCompare(leftValue);
        }
      } else if (sortDirection > 0) {
        compValue = leftValue - rightValue;
      } else {
        compValue = rightValue - leftValue;
      }
      return compValue;
    };

    this.sort();
  }
}

export default SortedCollection;
