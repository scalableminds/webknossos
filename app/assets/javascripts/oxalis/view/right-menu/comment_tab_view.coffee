### define
backbone.marionette : marionette
./comment_tab_item_view : CommentTabItemView
app : app
###

class CommentTabView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <div class="input-group" id="comment-navbar">
      <div class="input-group-btn">
        <button class="btn btn-default" id="comment-previous"><i class="fa fa-arrow-left"></i></button>
      </div>
      <input class="form-control" id="comment-input" type="text" value="<%= activeComment.get("content") %>" placeholder="Add comment">
      <div class="input-group-btn">
        <button class="btn btn-default" id="comment-next"><i class="fa fa-arrow-right"></i></button>
        <button class="btn btn-default dropdown-toggle" data-toggle="dropdown" id="comment-sort-button" title="sort">
          <i class="fa fa-sort-alpha-asc"></i>
        </button>
        <ul class="dropdown-menu pull-right" role="menu" id="comment-sort">
          <li>
            <a href="#" data-sort="asc">
              Ascending
              <i class="fa fa-check" id="sort-asc-icon"></i>
            </a>
          </li>
          <li>
            <a href="#" data-sort="desc">
              Descending
              <i class="fa fa-check" id= "sort-desc-icon"></i>
            </a>
        </ul>
      </div>
    </div>
    <div id="comment-container">
      <ul id="comment-list"></ul>
    </div>
  """)

  itemView : CommentTabItemView
  itemViewContainer : "#comment-list"
  itemViewOptions : ->
    activeComment : @activeComment
  templateHelpers : ->
    activeComment : @activeComment


  ui :
    "commentInput" : "input"

  events :
    "click #comment-sort" : "sortComments"
    "change input" : "handleInput"
    "click #comment-list li" : "setActive"
    "click #comment-next" : "nextComment"
    "click #comment-previous" : "previousComment"

  initialize : (options) ->

    { @_model } = options
    @activeComment = new Backbone.Model()

    @listenTo(app.vent, "model:sync", ->
      @collection = @_model.skeletonTracing.comments

      # Marionette internal function
      this._initialEvents()

      # select the activeNode if there is a comment...
      if comment = @collection.findWhere("node" : @getActiveNodeId())
        @activeComment = comment
      # ... or else set the first comment if one is available
      else if comment = @collection.first()
        @activeComment = comment

      @listenTo(app.vent, "activeNode:change", @updateInputElement)
      @render()
    )
    @listenTo(app.vent, "comments:deleteComment", @deleteComment)



  getActiveNodeId : ->

    return @_model.skeletonTracing.getActiveNodeId()


  setActiveNode : (activeComment) ->

    @activeComment = activeComment
    nodeId = activeComment.get("node")
    app.vent.trigger("activeNode:change", nodeId)


  updateInputElement : (nodeId) ->
    # responds to activeNode:change event
    content = ""
    if comment = @collection.findWhere(node : nodeId)
      @activeComment = comment
      content = comment.get("content")

    # populate the input element
    @ui.commentInput.val(content)


  handleInput : (evt) ->

    # add, delete or update a comment
    nodeId = @getActiveNodeId()
    commentText = $(evt.target).val()

    if comment = @collection.findWhere(node : nodeId)
      unless commentText == ""
        comment.set("content", commentText)
      else
        @collection.remove(comment)
    else
      if commentText != ""
        newComment = @collection.add(
          node : nodeId
          content: commentText
        )

        @setActiveNode(newComment)


  nextComment : ->

    nextComment = @collection.find((model) => model.get("node") > @activeComment.get("node"))
    if nextComment

      @setActiveNode(nextComment)


  previousComment : ->

    previousComment = _.findLast(@collection.models, (model) => model.get("node") < @activeComment.get("node"))
    if previousComment

      @setActiveNode(previousComment)


  # @stateLogger.push()
  # @trigger("updateComments")


  # TODO old method, replace with new
  deleteComment : (nodeID) ->

    comment = @collection.findWhere("node" : nodeID)
    if comment
      @collection.remove(comment)
      # TODO save the change
      #@stateLogger.push()
      @trigger("updateComments")

