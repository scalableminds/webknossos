### define
backbone.marionette
app : app
###

class CommentTabItemView extends Backbone.Marionette.ItemView

  tagName : "li"
  template : _.template("""
    <i class="fa <%= isActive() %>"></i>
    <a href="#"><%= node %> <%= content %></a>
   """)

  events :
    "click a" : "setActiveNode"

  templateHelpers : ->
    isActive : =>
      if @model.get("node") == @activeCommentId
        return "fa-angle-right"
      else
        return ""


  initialize : (options) ->

    @activeCommentId = options.activeComment.get("node")
    @listenTo(app.vent, "activeNode:change", @update)
    @listenTo(@model, "change", @render)


  update : (@activeCommentId) ->

    @render()


  setActiveNode : ->

    app.vent.trigger("activeNode:change", @model.get("node"))

