_          = require("lodash")
Marionette = require("backbone.marionette")

class HelpLogoView extends Marionette.ItemView

  className : "help-logo-view flex-column"
  template : _.template("""
    <div class="flex-overflow">
      <table class="table table-condensed table-nohead table-bordered">
        <tbody>
          <tr><th colspan="2">Controls</th></tr>
          <tr><td>I,O or Alt + Mousewheel</td><td>Zoom in/out</td></tr>
          <tr><td>Mousewheel or D and F</td><td>Move along 3rd axis</td></tr>
          <tr><td>Left Mouse drag or Arrow keys</td><td>Move</td></tr>
          <tr><td>Right click drag in 3D View</td><td>Rotate 3D View</td></tr>
          <tr><td>K,L</td><td>Scale up/down viewports</td></tr>
        </tbody>
      </table>
      <div class="logos">
        <img src="/assets/images/Max-Planck-Gesellschaft.svg" />
        <img src="/assets/images/MPI-brain-research.png" />
      </div>
    </div>
  """)

module.exports = HelpLogoView
