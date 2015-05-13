### define
libs/utils : Utils
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
###

class SettingsView extends Backbone.Marionette.ItemView


  template : _.template("""
    <div class="panel-group flex-overflow">

      <% _.forEach(subviewCreators, function (subview, key) { %>
        <div data-subview="<%= key %>"></div>
      <% }) %>

    </div>
  """)


  initialize : ->

    @model = @model[@modelName]

    Backbone.Subviews.add(this)


  render : ->

    if @model
      super()
    else
      @$el.html(Utils.loaderTemplate())


  serializeData : ->

    return { @subviewCreators }
