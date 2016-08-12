_          = require("lodash")
Marionette = require("backbone.marionette")

class SelectionItemView extends Marionette.ItemView

  tagName : "option"
  attributes : ->

    defaults =
      id : @model.get("id")
      value : @options.modelValue()

    if @options.defaultItem
      [[key, value]] = _.toPairs(@options.defaultItem)
      if @model.get(key) == value
        _.extend(defaults, selected : true)

    return defaults

  template : _.template("""
    <%- label %>
  """)

  initialize : (options) ->

    # a function to retrieve the option's value
    @modelValue = options.modelValue

    # a function to retrieve the option's label (displayed text)
    @modelLabel = options.modelLabel

    @listenTo(@, "render", @afterRender)


  serializeData : ->

    label = if @modelLabel then @modelLabel() else @modelValue()

    return {
      value : @modelValue()
      label : label
      id : @model.get("id")
    }


module.exports = SelectionItemView
