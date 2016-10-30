_          = require("lodash")
Marionette = require("backbone.marionette")

class UserScriptsModalView extends Marionette.View

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal">&times;</button>
          <h3>Add user script</h3>
        </div>
        <div class="modal-body">
          <textarea id="add-script-input" rows="10" autofocus></textarea>
        </div>
        <div class="modal-footer">
          <a href="#" id="add-script-button" class="btn btn-default">Add</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
        </div>
      </div>
    </div>
  """)

  ui :
    "inputBox" : "#add-script-input"

  events :
    "click #add-script-button" : "handleAddClick"

  attributes:
    "tabindex" : "-1"
    "role": "dialog"


  show : ->

    @$el.modal("show")


  handleAddClick : ->

    try
      eval(@ui.inputBox.val())
      # close modal if the script executed successfully
      @$el.modal("hide")
    catch error
      alert(error)


module.exports = UserScriptsModalView
