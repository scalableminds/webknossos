_          = require("lodash")
Marionette = require("backbone.marionette")

class SelectionItemView extends Marionette.ItemView

  tagName : "option"
  attributes : ->

    defaults =
      id : @model.get("id")
      value : @options.modelValue()

    if @options.defaultItem
      [[key, value]] = _.pairs(@options.defaultItem)
      if @model.get(key) == value
        return _.extend(defaults, selected : true)
      else
        return defaults

  template : _.template("""
    <%- value %>
  """)

  initialize : (options) ->

    @modelValue = options.modelValue

    @listenTo(@, "render", @afterRender)


  serializeData : ->

    return {
      value : @modelValue()
      id : @model.get("id")
    }


module.exports = SelectionItemView
