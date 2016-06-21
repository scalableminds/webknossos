app                = require("app")
Marionette         = require("backbone.marionette")
Input              = require("libs/input")
CommentList        = require("./comment_list_view")
React              = require("react")
ReactDOM           = require("react-dom")

class CommentTabView extends Marionette.ItemView

  className : "flex-column"
  template : _.template("""
    <div class="input-group" id="comment-navbar">
      <div class="input-group-btn">
        <button class="btn btn-default" id="comment-previous"><i class="fa fa-arrow-left"></i></button>
      </div>
      <input class="form-control" id="comment-input" type="text" value="<%- activeComment.get("content") %>" placeholder="Add comment">
      <div class="input-group-btn">
        <button class="btn btn-default" id="comment-next"><i class="fa fa-arrow-right"></i></button>
        <button class="btn btn-default" id="comment-sort" title="sort">
          <% if(isSortedAscending){ %>
            <i class="fa fa-sort-alpha-asc"></i>
          <% } else { %>
            <i class="fa fa-sort-alpha-desc"></i>
          <% } %>
        </button>
      </div>
    </div>
    <ul id="comment-list" class="flex-overflow"></ul>
  """)

  templateHelpers : ->
    activeComment : @activeComment
    isSortedAscending : @isSortedAscending


  ui :
    "commentInput" : "input"
    "commentList" : "#comment-list"

  events :
    "click #comment-sort" : "sortComments"
    "change input" : "handleInput"
    "click #comment-list li" : "setActive"
    "click #comment-next" : "nextComment"
    "click #comment-previous" : "previousComment"


  initialize : ->

    @activeComment = new Backbone.Model()
    @isSortedAscending = true

    @collection = @model.skeletonTracing.comments

    # select the activeNode if there is a comment...
    if comment = @collection.findWhere("node" : @getActiveNodeId())
      @activeComment = comment
    # ... or else set the first comment if one is available
    else if comment = @collection.first()
      @activeComment = comment

    # events
    @listenTo(@model.skeletonTracing, "newActiveNode", @updateInputElement)
    @listenTo(@model.skeletonTracing, "deleteComment", @deleteComment)
    @listenTo(@collection, "change add remove reset sort", @updateState)

    # keyboard shortcuts
    new Input.KeyboardNoLoop(
      "n" : => @nextComment()
      "p" : => @previousComment()
    )


  render : ->

    super()
    @commentList = ReactDOM.render(
      <CommentList onNewActiveNode={@setActiveNode}/>,
      @ui.commentList[0]
    )
    @updateState()


  updateState : ->

    return unless @commentList

    @commentList.setState(
      data : @collection
      activeNodeId : @getActiveNodeId()
      isSortedAscending : @isSortedAscending
    )


  getActiveNodeId : ->

    return @model.skeletonTracing.getActiveNodeId()


  setActiveNode : (activeComment) =>

    @activeComment = activeComment
    nodeId = activeComment.get("node")
    @model.skeletonTracing.setActiveNode(nodeId)
    @model.skeletonTracing.centerActiveNode()


  updateInputElement : (nodeId) ->
    # responds to activeNode:change event
    content = ""
    if comment = @collection.findWhere(node : nodeId)
      @activeComment = comment
      content = comment.get("content")

    # populate the input element
    @ui.commentInput.val(content)
    @updateState()


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
          content : commentText
        )

        @setActiveNode(newComment)


  nextComment : ->

    activeComment = @activeComment
    nextComment = @collection.find( ((model) -> @comparator(model) > @comparator(activeComment)), @collection)
    # try to wrap around if no next comment was found
    nextComment = @collection.at(0) if not nextComment
    if nextComment

      @setActiveNode(nextComment)


  previousComment : ->

    activeComment = @activeComment
    previousComment = _.findLast(@collection.models, ((model) -> @comparator(model) < @comparator(activeComment)), @collection)
    # try to wrap around if no previous comment was found
    previousComment = @collection.at(@collection.length - 1) if not previousComment
    if previousComment

      @setActiveNode(previousComment)


  sortComments : (evt) ->

    @isSortedAscending = !@isSortedAscending
    @collection.sort(@isSortedAscending)


  deleteComment : (nodeID) ->

    comment = @collection.findWhere("node" : nodeID)
    if comment
      @collection.remove(comment)
      @trigger("updateComments")

module.exports = CommentTabView
