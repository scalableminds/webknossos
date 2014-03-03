### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
admin/models/team/team_collection : TeamCollection
admin/views/user/team_role_modal_item_view : TeamRoleModalItem
###

class TeamRoleModal extends Backbone.Marionette.CompositeView

  tagName : "div"
  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Assign teams</h3>
    </div>
    <div class="modal-body">
      <header class="row-fluid">
        <h4 class="span8" for="teams">Teams</h4>
        <h4 class="span4" for="role">Role</h4>
      </header>
      <div id="team-list">
      </div>
    </div>
    <div class="modal-footer">
      <a class="btn btn-primary">Save</a>
      <a href="#" class="btn" data-dismiss="modal">Cancel</a>
    </div>
  """)

  itemView : TeamRoleModalItem
  itemViewContainer : "#team-list"
  events :
    "click .btn-primary" : "changeExperience"


  initialize : (args) ->

    @collection = new TeamCollection()
    @collection.fetch(
      data: "isEditable=true"
      silent : true
    ).done(=>
      @collection.goTo(1)
    )
    @userCollection = args.userCollection

    @listenTo(@, "after:item:added", @prefillModal)


  changeExperience : ->

    if @isValid()

      # Find all selected users that will be affected by the bulk action
      $("tbody input[type=checkbox]:checked").each(
        (i, element) =>
          user = @userCollection.findWhere(
            id: $(element).val()
          )

          # Find all selected teams
          teams = _.map(@$el.find("input[type=checkbox]:checked"), (element) ->
            return {
              team : $(element).val()
              role :
                name: $(element).parent().parent().parent().find("select   :selected").val()
            }
          )

          # In case all teams were unselected
          teams = teams || []

          # Verify user and update his teams
          user.save(
            "verified" : true
            "teams" : teams
          )

          return
      )

      @$el.modal("hide")

    else
      Toast.error("No role is selected!")


  isValid : ->

    isValid = true

    # Make sure that all selected checkboxes have a selected role
    @$el.find("input[type=checkbox]:checked").parent().parent().find("select :selected").each(
      (i, element) ->
        isValid = $(element).text() != "Modify roles..."
    )

    return isValid


  prefillModal : ->

    # If only one user is selected then prefill the modal with his current values
    $userTableCheckboxes = $("tbody input[type=checkbox]:checked")
    if $userTableCheckboxes.length < 2

      user = @userCollection.findWhere(
        id: $userTableCheckboxes.val()
      )

      # Select all the user's teams
      _.each(user.get("teams"),
        (team) =>

          # Check all his teams
          selector = """input[value="#{team.team}"]"""
          $teamCheckbox = @$el.find("#{selector}").prop("checked", true)

          # Select the role in the dropdown
          $teamCheckbox.closest(".row-fluid").find("option").filter( ->
            return $(this).text() == team.role.name
          ).prop('selected', true)
      )

