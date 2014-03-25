### define
backbone.marionette : marionette
underscore : _
###

class AbstractSettingView extends Backbone.Marionette.ItemView


  initialize : ({ @model, @name, @displayName }) ->

    console.log "Init", arguments
    @listenTo(@model, "change:#{@options.name}" , @render)


  serializeData : ->

    return {
      value : @model.get(@name)
      @name
      @displayName
    }
