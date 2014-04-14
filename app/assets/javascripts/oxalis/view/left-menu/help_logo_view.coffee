### define
underscore : _
backbone.marionette : marionette
###

class HelpLogoView extends Backbone.Marionette.ItemView

  className : "col-sm-12"
  template : _.template("""
    <table class="table table-condensed table-nohead table-bordered">
      <tbody>
        <tr><th colspan="2">Controls</th></tr>
        <tr><td>Left click or Arrow keys</td><td>Move</td></tr>
        <tr><td>Right click drag in 3D View</td><td>Rotate 3D View</td></tr>
        <tr><td>Q</td><td>Fullscreen</td></tr>
        <tr><td>K,L</td><td>Scale up/down viewports</td></tr>
        <tr><td>Mousewheel or D and F</td><td>Move along 3rd axis</td></tr>
        <tr><td>I,O or Alt + Mousewheel</td><td>Zoom in/out</td></tr>
      </tbody>
    </table>
  </div>
  <div>
    <img class="img-responsive" src="/assets/images/Max-Planck-Gesellschaft.svg")">
  </div>
  <div>
    <img class="img-responsive" src="/assets/images/Logo_MPI_cut.svg")">
  </div>
  """)
