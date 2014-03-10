### define
underscore : _
backbone.marionette : marionette
moment : moment
###

class StatisticListView extends Backbone.Marionette.ItemView

  tagName : "tr"
  template : _.template("""
    <td><%= name %></td>
    <td><%= moment.utc(timestamp).format("hh\:mm") %></td>
  """)

  templateHelpers :
    moment : moment