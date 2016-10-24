_          = require("lodash")
Marionette = require("backbone.marionette")
Clipboard  = require("clipboard-js")
Toast      = require("libs/toast")
ModalView  = require("admin/views/modal_view")

class ShareModalView extends ModalView

  headerTemplate : "<h3>Share</h3>"
  bodyTemplate : _.template("""
    <div class="form-group">
      <label for="task">Shareable Link</label>
      <div class="row">
        <div class="col-md-12">
          <div class="input-group">
            <input type="text" class="form-control" readonly value="<%- getUrl() %>"></input>
            <span class="input-group-btn">
              <button class="btn btn-default copy-btn" type="button"><i class="fa fa-copy"></i>Copy</button>
            </span>
          </div>
        </div>
      </div>
    </div>
  """)


  templateContext :
    getUrl : -> return ShareModalView::getUrl()


  events :
    "click input" : "copyToClipboard"
    "click .copy-btn" : "copyToClipboard"


  getUrl : ->

    loc = window.location

    # in readonly mode the pathname already contains "/readonly"
    pathname = loc.pathname
    pathname = pathname.replace("/readOnly", "")

    url = loc.origin + pathname + "/readOnly" + loc.hash
    return url


  copyToClipboard : ->

    url = @getUrl()
    Clipboard.copy(url).then(
      -> Toast.success("Position copied to clipboard")
    )

module.exports = ShareModalView
