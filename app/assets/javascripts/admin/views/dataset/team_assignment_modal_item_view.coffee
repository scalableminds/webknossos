### define
underscore : _
backbone.marionette : marionette
###

class TeamAssignmentModalItemView extends Backbone.Marionette.ItemView

  tagName : "li"
  template : _.template("""
    <label class="checkbox"><input type="checkbox" value="<%= name %>"><%= name %></label>
  """)