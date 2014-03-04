### define
underscore : _
backbone : backbone
###

class ProjectAnnotationCollection extends Backbone.Collection

  constructor : (taskId) ->
    @url = "/admin/tasks/#{taskId}/annotations"
    super()


  parse : (response) ->

 #     for aProject, index in projects

  #       id = aProject._owner.$oid
  #       owner = _.find(users, (u) -> u.id == id)

  #   if owner
  #         ownerName = owner.firstName + " " + owner.lastName
  #       else
  #         ownerName = "<deleted>"

    return response