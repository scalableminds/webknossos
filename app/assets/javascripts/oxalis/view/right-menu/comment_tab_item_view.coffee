### define
backbone.marionette
app : app
###

class CommentTabItemView extends Backbone.Marionette.ItemView

  tagName : "li"
  template : _.template("""
    <i class="fa <%= isActive() %>"></i>
    <a href="#"><%= content %></a>
   """)

  templateHelpers : ->
    isActive : =>
      if @model.get("node") == @activeCommentId
        return "fa-angle-right"
      else
        return ""


  initialize : (options) ->

    {@activeCommentId} = options
    @listenTo(app.vent, "commentTabView:updatedComments", @update)


  update : (@activeCommentId) ->

    @render()

