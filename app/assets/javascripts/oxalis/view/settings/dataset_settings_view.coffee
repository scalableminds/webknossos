### define
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
./category_views/colors_category_view : ColorsCategoryView
###

class DatasetSettingsView extends Backbone.Marionette.ItemView


  id : "dataset-settings"


  template : _.template("""
    <div class="panel-group accordion">

      <% _.forEach(subviewCreators, function (subview, key) { %>
        <div data-subview="<%= key %>"></div>
      <% }) %>

    </div>
  """)


  subviewCreators :

    "colors-controls" : ->

      return new ColorsCategoryView({ @model })


  initialize : ->

    Backbone.Subviews.add(this)


  serializeData : ->

    return { @subviewCreators }
