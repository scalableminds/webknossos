Backbone = require("backbone")

# A helper class to wrap the Backbone.Paginator lib and set some sensible
# defaults
#
# Make sure to always call fetch() with the option 'silent: true' and use
# strings instead of objects for the 'data' option.
# If you create

class SortedCollection extends Backbone.Collection

  setSort : (criteria, sortDirection) ->

    # Set your comparator function, pass the criteria.
    @comparator = @criteriaComparator(criteria, sortDirection)
    @sort()


  # Backbone.Collecetion's sort is overloaded. Needs 2 params for the right version.
  criteriaComparator : (criteria, sortDirection = "asc") ->

    return (a, b) ->
      aSortVal = a.get(criteria);
      bSortVal = b.get(criteria);

      # Whatever your sorting criteria.
      if  aSortVal < bSortVal
        return if sortDirection == "asc" then -1 else 1

      if aSortVal > bSortVal
        return if sortDirection == "asc" then 1 else -1
      else
        return 0

module.exports = SortedCollection
