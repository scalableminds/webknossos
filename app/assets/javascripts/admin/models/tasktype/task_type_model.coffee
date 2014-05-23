### define
underscore : _
format_utils : FormatUtils
###

class TaskTypeModel extends Backbone.Model

  # TODO: the following three lines need to be there for editing
  # and they shouldnt be there for the listview
  url : -> "/api/taskTypes/#{@id}"

  constructor : (@id) ->

    super({})


  parse : (response) ->

    response.formattedHash = FormatUtils.formatHash(response.id)
    response.formattedShortText = FormatUtils.formatShortText(response.summary)

    return response


  destroy : ->

    options = url : "/api/taskTypes/#{@get('id')}/delete"
    super(options)

