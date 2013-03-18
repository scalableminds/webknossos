### define 
jquery : $
../libs/toast : Toast
###

class View


  THEME_BRIGHT   : 0
  THEME_DARK     : 1

  currentTheme : null


  constructor : (@model) ->

    unless @webGlSupported()
      Toast.error("Couldn't initialise WebGL, please make sure you are using Google Chrome and WebGL is enabled.<br>"+
        "<a href='http://get.webgl.org/'>http://get.webgl.org/</a>")

    @renderer = new THREE.WebGLRenderer( clearColor: 0x000000, clearAlpha: 1.0, antialias: false )
    @scene = new THREE.Scene()

    { THEME_BRIGHT } = @
   
    @setTheme(THEME_BRIGHT)
    @createKeyboardCommandOverlay()

    @model.route.on({
      emptyBranchStack : =>
        Toast.error("No more branchpoints", false)
      noBranchPoints : =>
        Toast.error("Setting branchpoints isn't necessary in this tracing mode.", false)
      wrongDirection : =>
        Toast.error("You're tracing in the wrong direction")
      updateComments : (comments) => 
        @updateComments(comments)
      newActiveNode : => 
        @updateActiveComment()
        @updateActiveTree()
      deleteTree : => 
        @updateActiveComment()
        @updateTrees()
        @updateActiveTree()
      mergeTree : =>
        @updateTrees()
      reloadTrees : =>
        @updateTrees()
      newNode : => @updateActiveComment()
      newTreeName : => 
        @updateTrees()
        @updateActiveTree()
      newTree : => 
        @updateActiveComment()
        @updateTrees()
        @updateActiveTree() })

    @model.route.updateComments()
    @updateActiveTree()
    @updateTrees()

    # disable loader, show oxalis
    $("#loader").css("display" : "none")
    $("#container").css("display" : "inline")


  toggleTheme : ->

    { currentTheme, THEME_BRIGHT, THEME_DARK } = @

    if currentTheme is THEME_BRIGHT 
      @setTheme(THEME_DARK)
    else
      @setTheme(THEME_BRIGHT)


  setTheme : (theme) ->

    { THEME_BRIGHT, THEME_DARK } = @

    if theme is THEME_BRIGHT
      $("body").attr('class', 'bright')
    else
      $("body").attr('class', 'dark')

    @currentTheme = theme


  createKeyboardCommandOverlay : ->

    keycommands =
      "<table class=\"table table-condensed table-nohead\">
        <tbody>
          <tr><th colspan=\"2\">General</th><th colspan=\"2\">Viewports</th></tr>
          <tr><td>Leftclick or Arrow keys</td><td>Move</td><td>Mousewheel or D and F</td><td>Move along 3rd axis</td></tr>
          <tr><td>Leftclick</td><td>Select node</td><td>Rightclick</td><td>Set tracepoint</td></tr>
          <tr><td>Q</td><td>Fullscreen</td><td>I or Alt + Mousewheel</td><td>Zoom in</td></tr>
          <tr><td>K</td><td>Scale up viewports</td><td>O or Alt + Mousewheel</td><td>Zoom out</td></tr>
          <tr><td>L</td><td>Scale down viewports</td><td>B</td><td>Set branchpoint</td></tr>
          <tr><td>Del</td><td>Delete node/Split trees</td><td>J</td><td>Jump to last branchpoint</td></tr>
          <tr><td>Shift + Alt + Leftclick</td><td>Merge two trees</td><td>S</td><td>Center active node</td></tr>
          <tr><td>P</td><td>Previous comment</td><td>C</td><td>Create new tree</td></tr>
          <tr><td>N</td><td>Next comment</td><td>Shift + Mousewheel</td><td>Change node size</td></tr>
          <tr><td>T</td><td>Toggle theme</td><th colspan=\"2\">3D-view</th><td></td></tr>
          <tr><td>1</td><td>Toggle Skeleton Visibility</td><td>Mousewheel</td><td>Zoom in and out</td></tr>          
          <tr><td>M</td><td>Toggle mode</td><td></td><td></td></tr>
          <tr><th colspan=\"2\">Flightmode</th><td></td><td></td></tr>
          <tr><td>Mouse or Arrow keys</td><td>Rotation</td><td></td><td></td></tr>
          <tr><td>Shift + Mouse or Shift + Arrow</td><td>Rotation around Axis</td><td>W A S D</td><td>Strafe</td></tr>
          <tr><td>Space, Shift + Space</td><td>Forward, Backward</td><td>B, J</td><td>Set, Jump to last branchpoint</td></tr>
          <tr><td>K, L</td><td>Scale viewports</td><td>I, O</td><td>Zoom in and out</td><td></td></tr>
          <tr><td>Z, U</td><td>Start, stop recording waypoints</td><td>R</td><td>Reset rotation</td></tr> 
        </tbody>
      </table>
      <br>
      <p>All other options like moving speed, clipping distance can be adjusted in the options located to the left.
      Select the different categories to open/close them.
      Please report any issues.</p>"

    popoverTemplate = '<div class="popover key-overlay"><div class="arrow key-arrow"></div><div class="popover-inner"><h3 class="popover-title"></h3><div class="popover-content"><p></p></div></div></div>'
    $('#help-overlay').popover({html: true, placement: 'bottom', title: 'keyboard commands', content: keycommands, template: popoverTemplate})


  updateComments : (comments) ->
    
    commentList = $("#comment-list")
    commentList.empty()

    # DOM container to append all elements at once for increased performance
    newContent = document.createDocumentFragment()

    for comment in comments
      newContent.appendChild((
        $('<li>').append($('<i>', {"class": "icon-angle-right"}), 
        $('<a>', {"href": "#", "data-nodeid": comment.node, "text": comment.content})))[0])

    commentList.append(newContent)

    @updateActiveComment()


  updateActiveComment : ->

    comment = @model.route.getComment()
    if comment
      $("#comment-input").val(comment)
    else
      $("#comment-input").val("")

    oldIcon = $("#comment-container i.icon-arrow-right")
    if oldIcon.length
      oldIcon.toggleClass("icon-arrow-right", false)
      oldIcon.toggleClass("icon-angle-right", true)

    activeHref = $("#comment-container a[data-nodeid=#{@model.route.getActiveNodeId()}]")
    if activeHref.length

      newIcon = activeHref.parent("li").children("i")
      newIcon.toggleClass("icon-arrow-right", true)
      newIcon.toggleClass("icon-angle-right", false)

      # animate scrolling to the new comment
      $("#comment-container").animate({
        scrollTop: newIcon.offset().top - $("#comment-container").offset().top + $("#comment-container").scrollTop()}, 500)


  updateActiveTree : ->

    name = @model.route.getActiveTreeName()
    if name
      $("#tree-name-input").val(name)
      $("#tree-name").text(name)
    else
      $("#tree-name-input").val("")
      $("#tree-name").text("")


  updateTrees : ->

    trees = @model.route.getTrees()

    treeList = $("#tree-list")
    treeList.empty()

    newContent = document.createDocumentFragment()

    for tree in trees
      newContent.appendChild((
        $('<li>').append($('<a>', {"href": "#", "data-treeid": tree.treeId, "text": tree.name})))[0])
    treeList.append(newContent)


  webGlSupported : ->

    return window.WebGLRenderingContext and document.createElement('canvas').getContext('experimental-webgl')