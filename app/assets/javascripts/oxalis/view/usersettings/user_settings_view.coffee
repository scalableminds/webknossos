### define
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
./categoryviews/controls_category_view : ControlsCategoryView
./categoryviews/viewport_category_view : ViewportCategoryView
###

class UserSettingsView extends Backbone.Marionette.ItemView


  template : _.template("""
    <div class="panel-group accordion" id="user-settings">

      <% _.forEach(subviewCreators, function (subview, key) { %>
        <div data-subview="<%= key %>"></div>
      <% }) %>

    </div>
  """)


  subviewCreators :

    "category-controls" : ->

      return new ControlsCategoryView({ @model })

    "viewport-controls" : ->

      return new ViewportCategoryView({ @model })


  initialize : ->

    Backbone.Subviews.add(this)


  serializeData : ->

    return { @subviewCreators }
