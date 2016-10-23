app                    = require("app")
Marionette             = require("backbone.marionette")
Input                  = require("libs/input")
CommentList            = require("./comment_list")
React                  = require("react")
ReactDOM               = require("react-dom")
Utils                  = require("libs/utils")
scrollIntoViewIfNeeded = require("scroll-into-view-if-needed")

class CommentTabView extends Marionette.View

  className : "flex-column"
  template : _.template("""
    <div class="input-group" id="comment-navbar">
      <div class="input-group-btn">
        <button class="btn btn-default" id="comment-previous"><i class="fa fa-arrow-left"></i></button>
      </div>
      <input class="form-control" id="comment-input" type="text" value="<%- activeComment.comment ? activeComment.comment.content : '' %>" placeholder="Add comment">
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

  templateContext : ->
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

    @activeComment = {}
    @isSortedAscending = true

    # select the activeNode if there is a comment...
    if comment =  @getCommentForNode(@getActiveNodeId())
      @activeComment = @makeComment(comment)
    else
      # make null comment
      @activeComment = @makeComment()

    # events
    @listenTo(@model.skeletonTracing, "newActiveNode", @updateInputElement)
    @listenTo(@model.skeletonTracing, "reloadTrees" , @updateState)

    # keyboard shortcuts
    new Input.KeyboardNoLoop(
      "n" : => @nextComment()
      "p" : => @previousComment()
    )


  render : ->

    # tabs are not destroyed and a rerender would cause the react components to lose their state
    if not @commentList
      super()
      @commentList = ReactDOM.render(
        <CommentList onNewActiveNode={@setActiveNode}/>,
        @ui.commentList[0]
      )
      @updateState()

    # scroll active comment into view
    @ensureActiveCommentVisible()


  updateState : ->

    return unless @commentList

    @commentList.setState(
      data : @model.skeletonTracing.getTreesSortedBy("treeId", @isSortedAscending)
      activeNodeId : @getActiveNodeId()
      activeTreeId : @model.skeletonTracing.getActiveTreeId()
      isSortedAscending : @isSortedAscending
    )


  ensureActiveCommentVisible : ->

    activeNodeId = @getActiveNodeId()
    comment = $("#comment-tab-node-#{activeNodeId}")[0]
    scrollIntoViewIfNeeded(comment) if comment


  getActiveNodeId : ->

    return @model.skeletonTracing.getActiveNodeId()


  setActiveNode : (comment, treeId) =>

    @activeComment = @makeComment(comment, treeId)
    @model.skeletonTracing.setActiveNode(comment.node)
    @model.skeletonTracing.centerActiveNode()


  getCommentForNode : (nodeId) ->

    activeTree = @model.skeletonTracing.getActiveTree()
    return _.find(activeTree.comments, { node : nodeId })


  updateInputElement : (nodeId) ->
    # responds to activeNode:change event
    content = ""
    if comment = @getCommentForNode(nodeId)
      @activeComment = @makeComment(comment)
      content = comment.content

    # populate the input element
    @ui.commentInput.val(content)
    @updateState()


  handleInput : (evt) ->

    return if not @model.skeletonTracing.restrictionHandler.updateAllowed()

    # add, delete or update a comment
    nodeId = @getActiveNodeId()

    # don't add a comment if there is no active node
    return unless nodeId

    tree = @model.skeletonTracing.getActiveTree()
    commentText = $(evt.target).val()

    if comment = @getCommentForNode(nodeId)
      unless commentText == ""
        comment.content = commentText
      else
        tree.removeCommentWithNodeId(nodeId)
      @updateState()
    else
      if commentText != ""
        comment =
          node : nodeId
          content : commentText
        tree.comments.push(comment)

        @setActiveNode(comment, tree.treeId)

    @model.skeletonTracing.updateTree(tree)


  nextComment : (forward=true) ->

    sortAscending = if forward then @isSortedAscending else not @isSortedAscending

    activeComment = @activeComment

    # get tree of active comment or activeTree if there is no active comment
    nextTree = @model.skeletonTracing.getTree(activeComment.treeId)
    nextTree.comments.sort(Utils.compareBy("node", sortAscending))

    # try to find next comment for this tree
    nextComment = _.find(nextTree.comments,
      (comment) => @commentComparator(comment, sortAscending) > @commentComparator(activeComment.comment, sortAscending))

    # try to find next tree with at least one comment
    if not nextComment
      trees = @model.skeletonTracing.getTreesSortedBy("treeId", sortAscending)
      nextTree = _.find(trees,
        (tree) => @treeComparator(tree.treeId, sortAscending) > @treeComparator(activeComment.treeId, sortAscending) and tree.comments.length)

    # try to find any tree with at least one comment, starting from the beginning
    if not nextTree
      nextTree = _.find(trees, (tree) -> tree.comments.length)

    if not nextComment and nextTree
      nextTree.comments.sort(Utils.compareBy("node", sortAscending))
      nextComment = nextTree.comments[0]

    # if a comment was found, make it active
    if nextComment
      @setActiveNode(nextComment, nextTree.treeId)


  previousComment : ->

    @nextComment(false)


  sortComments : (evt) ->

    @isSortedAscending = !@isSortedAscending
    @updateState()


  # Helper functions

  makeComment : (comment, treeId) ->

    if comment is undefined
      return { comment : { node : null }, treeId : null }

    if treeId is undefined
      treeId = @model.skeletonTracing.getActiveTreeId()

    return { comment : comment, treeId : treeId }


  commentComparator : (comment, sortAscending) ->

    coefficient = if sortAscending then 1 else -1
    return comment.node * coefficient


  treeComparator : (treeId, sortAscending) ->

    coefficient = if sortAscending then 1 else -1
    return treeId * coefficient


module.exports = CommentTabView
