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
      <input class="form-control" id="comment-input" type="text" placeholder="Add comment">
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
    activeCommentId : @activeCommentId

  events :
    "click #comment-sort" : "sortComments"
    "change input" : "addComment"
    "click #comment-list li" : "setActive"
    "click #comment-next" : "nextComment"
    "click #comment-previous" : "previousComment"

  initialize : (options) ->

    {@_model} = options


    @listenTo(app.vent, "model:sync", ->
      @collection = @_model.skeletonTracing.comments
      @activeCommentId = @collection.first().get("node")
      @render()
    )

  getActiveNodeId : ->

    return @_model.skeletonTracing.getActiveNodeId()


  setActiveNodeId : (nodeId) ->

    @activeCommentId = nodeId
    @_model.skeletonTracing.setActiveNode(nodeId, false)
    # better call this instead
    # skeletontracingcontroller.setActiveNode(nodeID, false, true)
    app.vent.trigger("commentTabView:updatedComments", nodeId)


  addComment : (evt) ->

    newComment = @collection.add(
      node : @getActiveNodeId()
      content: $(evt.target).val()
    )

    @setActiveNodeId(newComment.get("node"))


  nextComment : ->

    nextComment = @collection.find((model) => model.get("node") > @activeCommentId)
    if nextComment

      @setActiveNodeId(nextComment.get("node"))


  previousComment : ->

    previousComment = _.findLast(@collection.models, (model) => model.get("node") < @activeCommentId)
    if previousComment

      @setActiveNodeId(previousComment.get("node"))



  updateComments : ->

    comments = @model.skeletonTracing.getComments( @model.user.get("sortCommentsAsc") )
    commentList = $("#comment-list")
    commentList.empty()

    # DOM container to append all elements at once for increased performance
    newContent = document.createDocumentFragment()

    lastTreeId = -1
    for comment in comments
      treeId = comment.node.treeId
      if treeId != lastTreeId
        newContent.appendChild((
          $('<ul>').append($('<i>', {"class": "fa fa-sitemap"}),
          $('<span>', {"data-treeid": treeId, "text": @model.skeletonTracing.getTree(treeId)?.name})))[0])
        lastTreeId = treeId
      newContent.appendChild((
        $('<li>').append($('<i>', {"class": "fa fa-angle-right"}),
        $('<a>', {"href": "#", "data-nodeid": comment.node.id, "text": comment.node.id + " - " + comment.content})))[0])

    commentList.append(newContent)

    @updateActiveCommentId()


  updateActiveCommentId : ->

    comment = @model.skeletonTracing.getComment()
    if comment
      $("#comment-input").val(comment)
    else
      $("#comment-input").val("")

    oldIcon = $("#comment-container i.fa-angle-right")
    if oldIcon.length
      oldIcon.toggleClass("fa-angle-right", false)

    activeHref = $("#comment-container a[data-nodeid=#{@model.skeletonTracing.getActiveNodeId()}]")
    if activeHref.length

      newIcon = activeHref.parent("li").children("i")
      newIcon.toggleClass("fa-angle-right", true)

      # animate scrolling to the new comment
      $("#comment-container").animate({
        scrollTop: newIcon.offset().top - $("#comment-container").offset().top + $("#comment-container").scrollTop()}, 250)
    else
      activeTree = $("#comment-container span[data-treeid=#{@model.skeletonTracing.getActiveTreeId()}]")
      if activeTree.length
        $("#comment-container").animate({
          scrollTop: activeTree.offset().top - $("#comment-container").offset().top + $("#comment-container").scrollTop()}, 250)

  updateCommentsSortButton : ->

    @toggleIconVisibility(
      @model.user.get("sortCommentsAsc"),
      $("#sort-asc-icon"),
    $("#sort-desc-icon"))

  setComment : (commentText) ->

    if @activeNode
      # remove any existing comments for that node
      for i in [0...@comments.length]
        if(@comments[i].node.id == @activeNode.id)
          @comments.splice(i, 1)
          @deletedCommentIndex = i
          break
      if commentText != ""
        @comments.push({node: @activeNode, content: commentText})
      @stateLogger.push()
      @trigger("updateComments")


  getComment : (nodeID) ->

    unless nodeID? then nodeID = @activeNode.id if @activeNode
    for comment in @comments
      if comment.node.id == nodeID then return comment.content
    return ""


  deleteComment : (nodeID) ->

    for i in [0...@comments.length]
      if(@comments[i].node.id == nodeID)
        @comments.splice(i, 1)
        @stateLogger.push()
        @trigger("updateComments")
        break


  nextCommentNodeID : (forward) ->

    length = @comments.length
    offset = if forward then 1 else -1

    unless @activeNode
      if length > 0 then return @comments[0].node.id

    if length == 0
      return null

    for i in [0...@comments.length]
      if @comments[i].node.id == @activeNode.id
        return @comments[(length + i + offset) % length].node.id

    if @deletedCommentIndex?
      offset = if forward then 0 else -1
      return @comments[(length + @deletedCommentIndex + offset) % length].node.id

    return @comments[0].node.id

