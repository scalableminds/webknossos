### define 
jquery : $
###

class View


  THEME_BRIGHT   : 0
  THEME_DARK     : 1

  curentTheme : false


  constructor : ->

    { THEME_BRIGHT } = @
   
    @setTheme(THEME_BRIGHT)
    @createKeyboardCommandOverlay()


  toggleTheme : ->

    { curentTheme, THEME_BRIGHT, THEME_DARK } = @

    if curentTheme is THEME_BRIGHT 
      @setTheme(THEME_DARK)
    else
      @setTheme(THEME_BRIGHT)


  setTheme : (theme) ->

    { THEME_BRIGHT, THEME_DARK } = @

    if theme is THEME_BRIGHT
      $("body").attr('class', 'bright')
    else
      $("body").attr('class', 'dark')

    @curentTheme = theme


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
          <tr><td>N</td><td>Next comment</td><th colspan=\"2\">3D-view</th><td></td></tr>
          <tr><td>T</td><td>Toggle theme</td><td>Mousewheel</td><td>Zoom in and out</td></tr>
          <tr><td>1</td><td>Toggle Skeleton Visibility</td><td></td><td></td></tr>          
          <tr><td>M</td><td>Toggle mode</td><td></td><td></td></tr>
          <tr><th colspan=\"2\">Flightmode</th><td></td><td></td></tr>
          <tr><td>Mouse or Arrow keys</td><td>Rotation</td><td></td><td></td></tr>
          <tr><td>Shift + Mouse or Shift + Arrow</td><td>Rotation around Axis</td><td>W A S D</td><td>Strafe</td></tr>
          <tr><td>Space, Shift + Space</td><td>Forward, Backward</td><td>B, J</td><td>Set, Jump to last branchpoint</td></tr>
          <tr><td>K, L</td><td>Scale viewports</td><td>I, O</td><td>Zoom in and out</td><td></td></tr>
          <tr><td>T, Z</td><td>Start, stop recording waypoints</td><td>R</td><td>Reset rotation</td></tr> 
        </tbody>
      </table>
      <br>
      <p>All other options like moving speed, clipping distance can be adjusted in the options located to the left.
      Select the different categories to open/close them.
      Please report any issues.</p>"

    popoverTemplate = '<div class="popover key-overlay"><div class="arrow key-arrow"></div><div class="popover-inner"><h3 class="popover-title"></h3><div class="popover-content"><p></p></div></div></div>'
    $('#help-overlay').popover({html: true, placement: 'bottom', title: 'keyboard commands', content: keycommands, template: popoverTemplate})

