### define
jquery : $
underscore : _
backbone.marionette : Marionette
libs/toast : Toast
libs/request : Request
app : app
admin/views/selection_view : SelectionView
admin/models/user/user_collection : UserCollection
###

class TaskTransferModalView extends Backbone.Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Transfer a Task</h3>
        </div>
        <div class="modal-body container-fluid">
          <div class="control-group">
            <div class="form-group">
              <label>New User's Name</label>
              <div class="datalist"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <a href="#" class="btn btn-primary transfer">Transfer</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
        </div>
      </div>
    </div>
  """)

  #   <input type="text" class="form-control" name="userName" placeholder="Type a user's name" value="" list="user-datalist" required autofocus>


  regions :
    "datalist" : ".datalist"

  events :
    "click .transfer" : "transferTask"


  initialize : (options) ->

    @url = options.url
    @userCollection = new UserCollection()


  onShow : ->

    selectionView = new SelectionView(
      #el : $("""<datalist id="user-datalist">""")
      collection : @userCollection
      childViewOptions :
        modelValue: -> return "#{@model.get("firstName")} #{@model.get("lastName")}"
    )
    @datalist.show(selectionView)

    @$el.modal("show")


  transferTask : (evt) ->

    evt.preventDefault()

    userID = @$("select :selected").attr("id")
    Request.send(
      url : @url
      method : "POST"
      data :
        "userId" : userID
    ).then(
      =>
        @destroyModal()
      (xhr) =>
        Toast.message(xhr.responseJSON.messages)
    )



  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hide.bs.modal", =>
      @$el.off("hide.bs.modal")
      app.vent.trigger("TaskTransferModal:refresh") #update pagination
    )
    @$el.modal("hide")

