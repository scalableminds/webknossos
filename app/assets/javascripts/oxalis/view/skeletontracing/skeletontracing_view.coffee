### define
jquery : $
underscore : _
libs/toast : Toast
../modal : modal
../../view : View
../merge_modal_view : MergeModalView
../../constants: constants
###

class SkeletonTracingView extends View

  constructor : (@model) ->

    super(@model)

    $('.volume-controls').hide()

    @model.skeletonTracing.on({
      emptyBranchStack : =>

        Toast.error("No more branchpoints", false)


      noBranchPoints : =>

        Toast.error("Setting branchpoints isn't necessary in this tracing mode.", false)


      wrongDirection : =>

        Toast.error("You're tracing in the wrong direction")


      updateComments : =>

        @updateComments()


      newActiveNode : =>

        @updateActiveComment()
        @updateActiveTree()


      deleteTree : =>

        @updateActiveComment()
        @updateTrees()


      mergeTree : =>

        @updateTrees()
        @updateComments()


      reloadTrees : =>

        @updateTrees()
        @updateComments()


      newNode : =>

        @updateActiveComment()
        @updateTreesDebounced()


      newTreeName : =>

        @updateTrees()
        @updateComments()


      newTree : =>

        @updateTrees()
        @updateComments()


      newTreeColor : =>

        @updateTreesDebounced()


      deleteActiveNode : =>

        @updateTrees()
    })


    @model.user.on
      sortTreesByNameChanged : =>
        @updateTreesSortButton()
        @updateTrees()
      sortCommentsAscChanged : =>
        @updateCommentsSortButton()
        @updateComments()

    autoSaveFailureMessage = "Auto-Save failed!"
    @model.skeletonTracing.stateLogger.on
      pushFailed : =>
        if @reloadDenied
          Toast.error(autoSaveFailureMessage, true)
        else
          modal.show("Several attempts to reach our server have failed. You should reload the page
            to make sure that your work won't be lost.",
            [ { id : "reload-button", label : "OK, reload", callback : ( ->
              $(window).on(
                "beforeunload"
                => return null)
              window.location.reload() )},
            {id : "cancel-button", label : "Cancel", callback : ( => @reloadDenied = true ) } ] )
      pushDone : =>
        Toast.delete("danger", autoSaveFailureMessage)

    $("a[href=#tab-comments]").on "shown", (event) =>
      @updateActiveComment()
    $("a[href=#tab-trees]").on "shown", (event) =>
      @updateActiveTree()

    $("#merge-button").on "click", (event) =>
      @showMergeModal()

    # set a node with static offset
    $("#add-node-button").on "click", (event) =>
      # create xy offset
      position = @model.flycam.getPosition()
      position[0] = position[0] + Math.pow(2, @model.flycam.getIntegerZoomStep())
      position[1] = position[1] + Math.pow(2, @model.flycam.getIntegerZoomStep())

      # add node
      @model.skeletonTracing.addNode(
        position,
        constants.TYPE_USUAL,
        constants.PLANE_XY, # xy viewport
        @model.flycam.getIntegerZoomStep()
      )

    @updateComments()
    @updateTrees()
    @updateTreesSortButton()
    @updateCommentsSortButton()

  showMergeModal : ->

    modalView = new MergeModalView(_model : @model)
    el = modalView.render().el
    $("#merge-modal").html(el)
    modalView.show()


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

    @updateActiveComment()


  updateActiveComment : ->

    comment = @model.skeletonTracing.getComment()
    if comment
      $("#comment-input").val(comment)
    else
      $("#comment-input").val("")

    oldIcon = $("#comment-container i.fa-angle-right")
    if oldIcon.length
      oldIcon.toggleClass("fa-angle-right", false)

    activeHref = $("#comment-container a[data-nodeid=#{@model.skeletonTracing.getActiveNodeId()}]")
    commentIcon = null

    if activeHref.length
      commentIcon = activeHref.parent("li").children("i")
      commentIcon.toggleClass("fa-angle-right", true)

    @scrollCommentsList(commentIcon)


  scrollCommentsList : (commentIcon) ->

    activeTreeId = @model.skeletonTracing.getActiveTreeId()
    activeTree = $("#comment-container span[data-treeid=#{activeTreeId}]")
    return unless activeTree.length > 0

    activeTreeTop = activeTree.offset().top
    height = $('#comment-container').height()

    if activeTree.length
      if commentIcon?
        commentIconTop = commentIcon.offset().top
        if commentIconTop - activeTreeTop > height / 2
          @scrollCommentsListTo(commentIconTop - height / 2)
          return
      @scrollCommentsListTo(activeTreeTop)


  scrollCommentsListTo : (top) ->

    container = $("#comment-container")
    offset = container.scrollTop() - container.offset().top
    container.animate(
      scrollTop: top + offset
      250
    )


  updateActiveTree : ->

    activeTree = @model.skeletonTracing.getTree()
    if activeTree
      $("#tree-name-input").val(activeTree.name)
      $("#tree-active-color").css("color": "##{('000000'+activeTree.color.toString(16)).slice(-6)}")
      activeHref = $("#tree-list a[data-treeid=#{activeTree.treeId}]")

    oldIcon = $("#tree-list i.fa-angle-right")
    if oldIcon.length
      oldIcon.toggleClass("fa-angle-right", false)
      oldIcon.toggleClass("fa-bull", true)

    if activeHref?.length

      newIcon = activeHref.parent("li").children("i")
      newIcon.toggleClass("fa-angle-right", true)
      newIcon.toggleClass("fa-bull", false)

      # animate scrolling to the new tree
      $("#tree-list").animate({
        scrollTop: newIcon.offset().top - $("#tree-list").offset().top + $("#tree-list").scrollTop()}, 250)


  updateTreesDebounced : ->
    # avoid lags caused by frequent DOM modification

    @updateTreesDebounced = _.debounce(
      => @updateTrees()
      200
    )
    @updateTreesDebounced()


  updateTrees : ->

    trees = @model.skeletonTracing.getTreesSorted()

    treeList = $("#tree-list")
    treeList.empty()

    newContent = document.createDocumentFragment()

    for tree in trees
      newContent.appendChild((
        $('<li>').append($('<i>', {"class": "fa fa-bull"}),
          $('<a>', {"href": "#", "data-treeid": tree.treeId})
          .append($('<span>', {"title": "nodes", "text": tree.nodes.length}).css("display": "inline-block", "width": "50px"),
          $('<i>', {"class": "fa fa-circle"}).css(
            "color": "##{('000000'+tree.color.toString(16)).slice(-6)}"),
          $('<span>', {"title": "name", "text": tree.name}) )) )[0])

    treeList.append(newContent)

    @updateActiveTree()


  updateTreesSortButton : ->

    @toggleIconVisibility(
      @model.user.get("sortTreesByName"),
      $("#sort-name-icon"),
      $("#sort-id-icon"))


  updateCommentsSortButton : ->

    @toggleIconVisibility(
      @model.user.get("sortCommentsAsc"),
      $("#sort-asc-icon"),
      $("#sort-desc-icon"))


  showFirstVisToggle : ->

    modal.show("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      [{id: "ok-button", label: "OK, Got it."}])


  toggleIconVisibility : (isFirst, firstIcon, secondIcon) ->

    if isFirst
      firstIcon.show()
      secondIcon.hide()
    else
      firstIcon.hide()
      secondIcon.show()
