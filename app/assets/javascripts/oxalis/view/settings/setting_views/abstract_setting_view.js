_          = require("lodash")
Marionette = require("backbone.marionette")

class AbstractSettingView extends Marionette.View


  initialize : ({ @model, @options }) ->

    @listenTo(@model, "change:#{@options.name}" , @update)
    @options = _.defaults(@options, {enabled: true})


  serializeData : ->

    return _.extend(
      @options
      { value : @model.get(@options.name) }
    )

module.exports = AbstractSettingView
