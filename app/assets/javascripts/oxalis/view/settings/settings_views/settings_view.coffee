_          = require("lodash")
Utils      = require("libs/utils")
Marionette = require("backbone.marionette")
Subviews   = require("backbone-subviews")

class SettingsView extends Marionette.ItemView


  template : _.template("""
    <div class="panel-group flex-overflow">

      <% _.forEach(subviewCreatorsList, function (key_value_pair) { %>
        <div data-subview="<%- key_value_pair[0] %>"></div>
      <% }) %>

    </div>
  """)


  initialize : ->

    if _.isArray(@modelName)
      @model = _.transform(@modelName,
                           (result, name) => result[name] = @model.get(name),
                           {})
    else
      @model = @model[@modelName]

    unless @subviewCreatorsList?
      throw new Error(
        "Subclasses of CategoryView must specify subviewCreatorsList")

    # subviewCreators hash needed for Subviews extension
    @subviewCreators = _.transform(
      @subviewCreatorsList
      (result, [key, value]) -> result[key] = value
      {}
    )

    Subviews.add(this)


  render : ->

    if @model
      super()
    else
      @$el.html(Utils.loaderTemplate())


  serializeData : ->

    return { @subviewCreatorsList }

module.exports = SettingsView
