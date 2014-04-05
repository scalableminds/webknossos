### define
libs/utils : Utils
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
###

class SettingsView extends Backbone.Marionette.ItemView


  template : _.template("""
    <div class="panel-group accordion">

      <% _.forEach(subviewCreators, function (subview, key) { %>
        <div data-subview="<%= key %>"></div>
      <% }) %>

    </div>
  """)


  initialize : ({ @_model }) ->

    @listenTo(app.vent, "model:sync", ->
      @model = @_model[@modelName]
      @render()
    )

    Backbone.Subviews.add(this)


  render : ->

    if @model
      super()
    else
      @$el.html(Utils.loaderTemplate())


  serializeData : ->

    return { @subviewCreators }
