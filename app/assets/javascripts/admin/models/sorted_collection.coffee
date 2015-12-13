Backbone = require("backbone")

class SortedCollection extends Backbone.Collection

  setSort : (criteria, sortDirection) ->

    # Set your comparator function, pass the criteria.
    @comparator = @criteriaComparator(criteria, sortDirection)
    @sort()


  # Backbone.Collecetion's sort is overloaded. Needs 2 params for the right version.
  criteriaComparator : (criteria, sortDirection = 1) ->

    return (a, b) ->
      aSortVal = a.get(criteria);
      bSortVal = b.get(criteria);

      # Whatever your sorting criteria.
      if aSortVal < bSortVal
        return if sortDirection == 1 then -1 else 1

      if aSortVal > bSortVal
        return if sortDirection == 1 then 1 else -1
      else
        return 0

module.exports = SortedCollection
