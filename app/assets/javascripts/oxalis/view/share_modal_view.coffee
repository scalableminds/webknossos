### define
underscore : _
backbone.marionette : Marionette
clipboard : Clipboard
###

class ShareModalView extends Backbone.Marionette.ItemView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Share</h3>
        </div>
        <div class="modal-body container-fluid">
          <div class="form-group">
            <label for="task">Shareable Link</label>
            <div class="row">
              <div class="col-md-12">
                <div class="input-group">
                  <input type="text" class="form-control" readonly value="<%= geturl() %>"></input>
                  <span class="input-group-btn">
                    <button class="btn btn-default copy-btn" type="button"><i class="fa fa-copy"></i>Copy</button>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  """)

  templateHelpers :

    geturl : ->
      loc = window.location

      # in readonly mode the pathname already contains "/readonly"
      pathname = loc.pathname
      pathname = pathname.replace("/readOnly", "")

      url = loc.origin + pathname + "/readOnly" + loc.hash
      return url


  events :
    "click input" : "copyUrl"


  initialize : (options) ->

    @_model = options._model


  show : ->

    @$el.modal("show")


  copyUrl : ->

    @$el.find(".copy-btn").click()


  onRender : ->

    @clipboard = new Clipboard(".copy-btn" , {
      target : =>
        @$el.find("input")[0]
    })

    @$el.on("hidden.bs.modal", => @destroy())


  onDestroy : ->

    @clipboard.destroy()

