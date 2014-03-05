### define
underscore : _
backbone.marionette : Marionette
###

class SelectionItemView extends Backbone.Marionette.ItemView

  tagName : "option"
  attributes : ->
    id : @model.get("id")
    value : @model.get("value")

  template : _.template("""
    <%= value %>
  """)


  initialize : (options) ->

    @modelValue = options.modelValue


  serializeData : ->

    return {
      value : @modelValue()
      id : @model.get("id")
    }