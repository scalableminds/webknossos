$           = require("jquery")
_           = require("lodash")
Clipboard   = require("clipboard-js")
Marionette  = require("backbone.marionette")
Toast       = require("libs/toast")
ModalView   = require("admin/views/modal_view")


class AnonymousTaskListModal extends ModalView

  headerTemplate : _.template("<h3>Anonymous Task Links for Task <%- id %></h3>")
  bodyTemplate : _.template("""
    <textarea class="form-control" style="min-height: 200px">
<%- directLinks.join("\\n") %>
    </textarea>
  """)
  footerTemplate : """
    <a href="#" class="btn btn-primary"><i class="fa fa-copy"></i>Copy</a>
    <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
  """

  events :
    "click .btn-primary" : "copyToClipboard"


  copyToClipboard : (evt) ->

    evt.preventDefault()

    links = @model.get("directLinks").join("\n")
    Clipboard.copy(links).then(
      -> Toast.success("Links copied to clipboard")
    )

module.exports = AnonymousTaskListModal
