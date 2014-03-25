### define
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
./categoryviews/controls_category_view : ControlsCategoryView
###

class UserSettingsView extends Backbone.Marionette.CompositeView

  # TODO: remove accordion* classes after bootstrap 3 update

  template : _.template("""
    <div class="panel-group accordion" id="user-settings">

      <div data-subview="category-controls"></div>

    </div>
  """)


  initialize : ->

    Backbone.Subviews.add(this)


  subviewCreators :

    "category-controls" : ->

      return new ControlsCategoryView({@model})
