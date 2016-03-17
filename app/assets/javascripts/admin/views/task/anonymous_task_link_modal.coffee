$           = require("jquery")
_           = require("lodash")
Clipboard   = require("clipboard-js")
Marionette  = require("backbone.marionette")
Toast       = require("libs/toast")


class AnonymousTaskListModal extends Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Anonymous Task Links for Task <%- id %></h3>
        </div>
        <div class="modal-body container-fluid">
        <textarea class="form-control" style="min-height: 200px">
    <%- directLinks.join("\\n") %>
        </textarea>
        <div class="modal-footer">
          <a href="#" class="btn btn-primary"><i class="fa fa-copy"></i>Copy</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
        </div>
      </div>
    </div>
  """)

  events :
    "click .btn-primary" : "copyToClipboard"

  copyToClipboard : (evt) ->

    evt.preventDefault()

    links = @model.get("directLinks").join("\n")
    Clipboard.copy(links).then(
      -> Toast.success("Links copied to clipboard")
    )

module.exports = AnonymousTaskListModal
