### define
underscore : _
backbone.marionette : Marionette
###

class SelectionItemView extends Backbone.Marionette.ItemView

  tagName : "option"

  template : _.template("""
    <%= value %>
  """)


  initialize : (options) ->

    @modelValue = options.modelValue
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
    )