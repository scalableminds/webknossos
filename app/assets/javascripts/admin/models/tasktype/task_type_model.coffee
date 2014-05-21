### define
underscore : _
###

class TaskTypeModel extends Backbone.Model

  destroy : ->

    options = url : "/api/taskTypes/#{@get('id')}/delete"
    super(options)

