$              = require("jquery")
_              = require("lodash")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")
Request        = require("libs/request")
app            = require("app")
SelectionView  = require("admin/views/selection_view")
ModalView      = require("admin/views/modal_view")
UserCollection = require("admin/models/user/user_collection")

class TaskTransferModalView extends ModalView

  headerTemplate : "<h3>Transfer a Task</h3>"
  bodyTemplate : _.template("""
    <div class="control-group">
      <div class="form-group">
        <label>New User's Name</label>
        <div class="datalist"></div>
      </div>
    </div>
  """)
  footerTemplate : """
    <a href="#" class="btn btn-primary transfer">Transfer</a>
    <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
  """


  regions :
    "datalist" : ".datalist"

  events :
    "click .transfer" : "transferTask"


  initialize : (options) ->

    @url = options.url
    @userCollection = new UserCollection()


  onRender : ->

    selectionView = new SelectionView(
      collection : @userCollection
      childViewOptions :
        modelValue: -> return "#{@model.get("firstName")} #{@model.get("lastName")} (#{@model.get("email")})"
    )
    @showChildView("datalist", selectionView)

    @$el.modal("show")


  transferTask : (evt) ->

    evt.preventDefault()

    userID = @$("select :selected").attr("id")
    Request.sendJSONReceiveJSON(
      @url,
      data:
        "userId" : userID
    ).then( =>
      @destroy()
    )


module.exports = TaskTransferModalView
