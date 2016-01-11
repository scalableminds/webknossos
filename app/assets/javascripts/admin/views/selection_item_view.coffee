_          = require("lodash")
Marionette = require("backbone.marionette")

class SelectionItemView extends Marionette.ItemView

  tagName : "option"
  attributes : ->
    if @options.defaultItem
      [[key, value]] = _.pairs(@options.defaultItem)
      if @model.get(key) == value
        return selected : true
      else
        return {}

  template : _.template("""
    <%- value %>
  """)

  initialize : (options) ->

    @modelValue = options.modelValue

    # in the taskcreate form the tasktype select must distinguish between value and innerHTML
    @modelName = options.modelName

    @listenTo(@, "render", @afterRender)


  serializeData : ->

    return {
      value : @modelValue()
      id : @model.get("id")
    }


  afterRender : ->

    @$el.attr(
      id : @model.get("id")
      value : @modelValue()
    ).html(
      if @modelName?
        @modelName()
      else
        @modelValue()
    )

module.exports = SelectionItemView
