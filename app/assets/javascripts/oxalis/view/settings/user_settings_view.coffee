### define
libs/utils : Utils
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
./category_views/controls_category_view : ControlsCategoryView
./category_views/viewport_category_view : ViewportCategoryView
./category_views/view_category_view : ViewCategoryView
###

class UserSettingsView extends Backbone.Marionette.ItemView


  id : "user-settings"


  template : _.template("""
    <div class="panel-group accordion">

      <% _.forEach(subviewCreators, function (subview, key) { %>
        <div data-subview="<%= key %>"></div>
      <% }) %>

    </div>
  """)


  subviewCreators :

    "controls-category" : ->

      return new ControlsCategoryView({ @model })

    "viewport-category" : ->

      return new ViewportCategoryView({ @model })

    "view-category" : ->

      return new ViewCategoryView({ @model })


  initialize : ({ @_model }) ->

    @listenTo(app.vent, "model:sync", ->
      @model = @_model.user
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
