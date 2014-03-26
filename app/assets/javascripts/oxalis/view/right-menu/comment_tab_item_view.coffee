### define
backbone.marionette
###

class CommentTabItemView extends Backbone.Marionette.ItemView

  tagName : "li"
  template : _.template("""
    <i class="fa"></i>
    <a href="#" data-nodeid="<%= node.id %>"><%= content %></a>
   """)

