### define
underscore : _
###

class TaskTypeModel extends Backbone.Model

  destroy : ->

    options = url : "/admin/taskTypes/#{@get('id')}/delete"
    super(options)

