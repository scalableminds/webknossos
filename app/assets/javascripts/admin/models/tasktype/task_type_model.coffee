_           = require("lodash")
FormatUtils = require("format_utils")

class TaskTypeModel extends Backbone.Model

  url : -> "/api/taskTypes/#{@id}"

  parse : (response) ->

    response.formattedHash = FormatUtils.formatHash(response.id)
    response.formattedShortText = FormatUtils.formatShortText(response.description)

    return response


  destroy : ->

    options = url : "/api/taskTypes/#{@get('id')}/delete"
    super(options)

module.exports = TaskTypeModel
