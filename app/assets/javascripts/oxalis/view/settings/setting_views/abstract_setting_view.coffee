_          = require("lodash")
Marionette = require("backbone.marionette")

class AbstractSettingView extends Marionette.View


  initialize : ({ @model, @options }) ->

    @listenTo(@model, "change:#{@options.name}" , @update)


  serializeData : ->

    return _.extend(
      @options
      { value : @model.get(@options.name) }
    )

module.exports = AbstractSettingView
