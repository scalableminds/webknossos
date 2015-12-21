_          = require("lodash")
Utils      = require("libs/utils")
Marionette = require("backbone.marionette")
Subviews   = require("backbone-subviews")

class SettingsView extends Marionette.ItemView


  template : _.template("""
    <div class="panel-group flex-overflow">

      <% _.forEach(subviewCreators, function (subview, key) { %>
        <div data-subview="<%= key %>"></div>
      <% }) %>

    </div>
  """)


  initialize : ->

    @model = @model[@modelName]

    Subviews.add(this)


  render : ->

    if @model
      super()
    else
      @$el.html(Utils.loaderTemplate())


  serializeData : ->

    return { @subviewCreators }

module.exports = SettingsView
