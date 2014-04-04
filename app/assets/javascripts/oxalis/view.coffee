### define
jquery : $
../libs/toast : Toast
./constants : constants
./view/modal : modal
three : THREE
###

class View

  constructor : (@model) ->

    unless @webGlSupported()
      Toast.error("Couldn't initialise WebGL, please make sure you are using Google Chrome and WebGL is enabled.<br>"+
        "<a href='http://get.webgl.org/'>http://get.webgl.org/</a>")

    @renderer = new THREE.WebGLRenderer( clearColor: 0x000000, clearAlpha: 1.0, antialias: false )
    @scene = new THREE.Scene()

    @setTheme(constants.THEME_BRIGHT)
    @createKeyboardCommandOverlay()


    # disable loader, show oxalis
    $("#loader").hide()
    $("#container").removeClass("hide")


  toggleTheme : ->

    if @currentTheme is constants.THEME_BRIGHT
      @setTheme(constants.THEME_DARK)
    else
      @setTheme(constants.THEME_BRIGHT)


  setTheme : (theme) ->

    if theme is constants.THEME_BRIGHT
      $("body").attr('class', 'bright')
    else
      $("body").attr('class', 'dark')

    @currentTheme = theme


  setMode : (mode) ->

    @createKeyboardCommandOverlay(mode)


  createKeyboardCommandOverlay : (mode) ->

    generalKeys =
      '<tr><th colspan="4">General</th></tr>
      <tr><td>Q</td><td>Fullscreen</td><td>K,L</td><td>Scale up/down viewports</td></tr>
      <tr><td>P,N</td><td>Previous/Next comment</td><td>Del</td><td>Delete node/Split trees</td></tr>
      <tr><td>C</td><td>Create new tree</td><td>Shift + Alt + Leftclick</td><td>Merge two trees</td></tr>
      <tr><td>T</td><td>Toggle theme</td><td>M</td><td>Toggle mode</td></tr>
      <tr><td>1</td><td>Toggle skeleton visibility</td><td>2</td><td>Toggle inactive tree visibility</td></tr>
      <tr><td>Shift + Mousewheel</td><td>Change node radius</td><td></td><td></td></tr>'

    TDViewKeys =
      '<tr><th colspan="4">3D-view</th></tr>
      <tr><td>Mousewheel</td><td>Zoom in and out</td><td>Rightclick drag</td><td>Rotate 3D View</td></tr>'
    viewportKeys =
      '<tr><th colspan="4">Viewports</th></tr>
      <tr><td>Leftclick or Arrow keys</td><td>Move</td><td>Shift + Leftclick</td><td>Select node</td></tr>
      <tr><td>Mousewheel or D and F</td><td>Move along 3rd axis</td><td>Rightclick</td><td>Set tracepoint</td></tr>
      <tr><td>I,O or Alt + Mousewheel</td><td>Zoom in/out</td><td>B,J</td><td>Set/Jump to branchpoint</td></tr>
      <tr><td>S</td><td>Center active node</td><td></td><td></td></tr>'
    arbitraryKeys =
      '<tr><th colspan="4">Flightmode</th></tr>
      <tr><td>Mouse or Arrow keys</td><td>Rotation</td><td>R</td><td>Reset rotation</td></tr>
      <tr><td>Shift + Mouse or Shift + Arrow</td><td>Rotation around Axis</td><td>W A S D</td><td>Move</td></tr>
      <tr><td>Space</td><td>Forward</td><td>B, J</td><td>Set/Jump to last branchpoint</td></tr>
      <tr><td>Y</td><td>Center active node</td><td>I, O</td><td>Zoom in and out</td></tr>
      <tr><td>Z, U</td><td>Start/Stop recording waypoints</td><td>Shift + Space</td><td>Delete active node, Recenter previous node</td></tr>'
    volumeKeys =
      '<tr><th colspan="4">Volume Tracing</th></tr>
      <tr><td>Left Mouse drag</td><td>Add to current Cell</td><td>Ctrl + Left Mouse drag / Arrow keys</td><td>Move</td></tr>
      <tr><td>Shift + Left Mouse drag / Right Mouse drag</td><td>Remove voxels from cell</td><td>Left mouse click</td><td>Set active cell</td></tr>
      <tr><td>C</td><td>Create new cell</td><td></td><td></td></tr>'

    html = """<div class="modal-dialog modal-lg">
                <div class="modal-content">
                  <div class="modal-header">
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                    <h3>Keyboard Shortcuts</h3></div>
                    <div class="modal-body" id="help-modal-body"><p>
                    <table class="table table-condensed table-nohead table-bordered"><tbody>"""

    html += generalKeys
    if mode == constants.MODE_PLANE_TRACING
      html += viewportKeys + TDViewKeys
    else if mode == constants.MODE_ARBITRARY or mode == constants.MODE_ARBITRARY_PLANE
      html += arbitraryKeys
    else if mode == constants.MODE_VOLUME
      html += volumeKeys

    html += """</tbody>
            </table>
            <br>
            <p>All other options like moving speed, clipping distance and particle size can be adjusted in the options located to the left.
            <br>Select the different categories to open/close them.
            Please report any issues.</p>
            </p></div><div class="modal-footer">
            <a href="#" class="btn btn-default" data-dismiss="modal">Close</a></div>
            </div>
            </div>"""

    $("#help-modal").html(html)


  webGlSupported : ->

    return window.WebGLRenderingContext and document.createElement('canvas').getContext('experimental-webgl')
