### define 
jquery : $
../../libs/toast : Toast
./modal : modal
../view : View
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
        @updateTreesThrottled()


      newTreeName : => 

        @updateTrees()
        @updateComments()


      newTree : => 

        @updateTrees()
        @updateComments()


      newActiveTreeColor : =>

        @updateTrees()


      deleteActiveNode : =>

        @updateTrees() })


    @model.user.on
      sortTreesByNameChanged : =>
        @updateTreesSortButton()
        @updateTrees()
      sortCommentsAscChanged : =>
        @updateCommentsSortButton()
        @updateComments()

    @model.skeletonTracing.stateLogger.on
      pushFailed       : (critical) =>
        if not critical or @reloadDenied
          Toast.error("Auto-Save failed!")
        else
          modal.show("Several attempts to reach our server have failed. You should reload the page
            to make sure that your work won't be lost.",
            [ { id : "reload-button", label : "OK, reload", callback : ( ->
              $(window).on(
                "beforeunload"
                =>return null)
              window.location.reload() )},
            {id : "cancel-button", label : "Cancel", callback : ( => @reloadDenied = true ) } ] )

    $("a[href=#tab-comments]").on "shown", (event) =>
      @updateActiveComment()
    $("a[href=#tab-trees]").on "shown", (event) =>
      @updateActiveTree()

    @updateComments()
    @updateTrees()
    @updateTreesSortButton()
    @updateCommentsSortButton()


  updateComments : ->
    
    comments = @model.skeletonTracing.getComments( @model.user.sortCommentsAsc )
    commentList = $("#comment-list")
    commentList.empty()

    # DOM container to append all elements at once for increased performance
    newContent = document.createDocumentFragment()

    lastTreeId = -1
    for comment in comments
      treeId = comment.node.treeId
      if treeId != lastTreeId
        newContent.appendChild((
          $('<li>').append($('<i>', {"class": "icon-sitemap"}),
          $('<span>', {"data-treeid": treeId, "text": @model.skeletonTracing.getTree(treeId)?.name})))[0])
        lastTreeId = treeId
      newContent.appendChild((
        $('<li>').append($('<i>', {"class": "icon-angle-right"}), 
        $('<a>', {"href": "#", "data-nodeid": comment.node.id, "text": comment.node.id + " - " + comment.content})))[0])

    commentList.append(newContent)

    @updateActiveComment()


  updateActiveComment : ->

    comment = @model.skeletonTracing.getComment()
    if comment
      $("#comment-input").val(comment)
    else
      $("#comment-input").val("")

    oldIcon = $("#comment-container i.icon-arrow-right")
    if oldIcon.length
      oldIcon.toggleClass("icon-arrow-right", false)
      oldIcon.toggleClass("icon-angle-right", true)

    activeHref = $("#comment-container a[data-nodeid=#{@model.skeletonTracing.getActiveNodeId()}]")
    if activeHref.length

      newIcon = activeHref.parent("li").children("i")
      newIcon.toggleClass("icon-arrow-right", true)
      newIcon.toggleClass("icon-angle-right", false)

      # animate scrolling to the new comment
      $("#comment-container").animate({
        scrollTop: newIcon.offset().top - $("#comment-container").offset().top + $("#comment-container").scrollTop()}, 250)
    else
      activeTree = $("#comment-container span[data-treeid=#{@model.skeletonTracing.getActiveTreeId()}]")
      if activeTree.length
        $("#comment-container").animate({
          scrollTop: activeTree.offset().top - $("#comment-container").offset().top + $("#comment-container").scrollTop()}, 250)


  updateActiveTree : ->

    activeTree = @model.skeletonTracing.getTree()
    if activeTree
      $("#tree-name-input").val(activeTree.name)
      $("#tree-name").text(activeTree.name)
      $("#tree-active-color").css("color": "##{('000000'+activeTree.color.toString(16)).slice(-6)}")
      activeHref = $("#tree-list a[data-treeid=#{activeTree.treeId}]")

    oldIcon = $("#tree-list i.icon-arrow-right")
    if oldIcon.length
      oldIcon.toggleClass("icon-arrow-right", false)
      oldIcon.toggleClass("icon-bull", true)

    if activeHref?.length

      newIcon = activeHref.parent("li").children("i")
      newIcon.toggleClass("icon-arrow-right", true)
      newIcon.toggleClass("icon-bull", false)

      # animate scrolling to the new tree
      $("#tree-list").animate({
        scrollTop: newIcon.offset().top - $("#tree-list").offset().top + $("#tree-list").scrollTop()}, 250)


  updateTreesThrottled : ->
    # avoid lags caused by frequent DOM modification

    @updateTreesThrottled = _.throttle(
      => @updateTrees()
      1000
    )
    @updateTreesThrottled()


  updateTrees : ->

    trees = @model.skeletonTracing.getTreesSorted()

    treeList = $("#tree-list")
    treeList.empty()

    newContent = document.createDocumentFragment()

    for tree in trees
      newContent.appendChild((
        $('<li>').append($('<i>', {"class": "icon-bull"}),
          $('<a>', {"href": "#", "data-treeid": tree.treeId})
          .append($('<span>', {"title": "nodes", "text": tree.nodes.length}).css("display": "inline-block", "width": "50px"),
          $('<i>', {"class": "icon-sign-blank"}).css(
            "color": "##{('000000'+tree.color.toString(16)).slice(-6)}"),
          $('<span>', {"title": "name", "text": tree.name}) )) )[0])

    treeList.append(newContent)

    @updateActiveTree()


  updateTreesSortButton : ->

    @toggleIconVisibility(
      @model.user.sortTreesByName,
      $("#sort-name-icon"),
      $("#sort-id-icon"))


  updateCommentsSortButton : ->

    @toggleIconVisibility(
      @model.user.sortCommentsAsc,
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
