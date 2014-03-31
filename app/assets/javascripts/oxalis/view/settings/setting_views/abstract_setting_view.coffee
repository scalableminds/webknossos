### define
backbone.marionette : marionette
underscore : _
###

class AbstractSettingView extends Backbone.Marionette.ItemView


  initialize : ({ @model, @options }) ->

    @listenTo(@model, "change:#{@options.name}" , @update)


  serializeData : ->

    return _.extend(
      @options
      { value : @model.get(@options.name) }
    )
