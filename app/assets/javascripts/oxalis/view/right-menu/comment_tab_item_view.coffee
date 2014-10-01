### define
backbone.marionette : Marionette
app : app
libs/utils : Utils
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

    {activeComment, @parent} = options
    @activeCommentId = activeComment.get("node")

    @listenTo(@parent._model.skeletonTracing, "newActiveNode", @update)
    @listenTo(@model, "change", @render)


  update : (@activeCommentId) ->

    @render()
    # scroll to active one
    if @model.get("node") == @activeCommentId and not Utils.isElementInViewport(@el)
      @el.scrollIntoView()


  setActiveNode : ->

    @parent.setActiveNode(@model)


