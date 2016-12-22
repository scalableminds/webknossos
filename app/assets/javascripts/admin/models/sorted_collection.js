Backbone = require("backbone")

class SortedCollection extends Backbone.Collection

  initialize : ->

    if @sortAttribute
      @setSort(@sortAttribute, "asc")


  setSort : (field, sortDirection) ->

    if sortDirection == "asc"
      sortDirection = 1
    if sortDirection == "desc"
      sortDirection = -1

    # Set your comparator function, pass the field.
    @comparator = (left, right) ->
      leftValue  = left.get(field)
      rightValue = right.get(field)
      return if _.isString(leftValue) && _.isString(rightValue)
          if sortDirection > 0
            leftValue.localeCompare(rightValue)
          else
            rightValue.localeCompare(leftValue)
        else
          if sortDirection > 0
            leftValue - rightValue
          else
            rightValue - leftValue

    @sort()


module.exports = SortedCollection
