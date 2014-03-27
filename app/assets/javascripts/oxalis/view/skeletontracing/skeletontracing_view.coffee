### define
jquery : $
libs/toast : Toast
../modal : modal
../../view : View
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

      newActiveNode : =>

        @updateActiveTree()


      deleteTree : =>

        #@updateActiveComment()
        @updateTrees()


      mergeTree : =>

        @updateTrees()
        @updateComments()


      reloadTrees : =>

        @updateTrees()
        #@updateComments()


      newNode : =>

        #@updateActiveComment()
        @updateTreesDebounced()


      newTreeName : =>

        @updateTrees()
        #@updateComments()


      newTree : =>

        @updateTrees()
        #@updateComments()


      newTreeColor : =>

        @updateTreesDebounced()


      deleteActiveNode : =>

        @updateTrees()
    })


    @model.user.on
      sortTreesByNameChanged : =>
        @updateTreesSortButton()
        @updateTrees()

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
                => return null)
              window.location.reload() )},
            {id : "cancel-button", label : "Cancel", callback : ( => @reloadDenied = true ) } ] )

    $("a[href=#tab-trees]").on "shown", (event) =>
      @updateActiveTree()

    @updateTrees()
    @updateTreesSortButton()


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
