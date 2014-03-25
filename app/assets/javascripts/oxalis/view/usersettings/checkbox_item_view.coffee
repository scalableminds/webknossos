### define
backbone.marionette : marionette
underscore : _
###

class CheckboxItemView extends Backbone.Marionette.ItemView


  template : _.template("""
    <label class="checkbox">
      <input type="checkbox" <%= boolToChecked(inverseX) %> data-attribute="inverseX">
    </label>
  """)


  events :


  constructor : ->

