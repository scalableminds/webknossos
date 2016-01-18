_                    = require("lodash")
Backbone             = require("backbone")

class UserAnnotationCollection extends Backbone.Collection

  url : -> "/api/users/#{@userId}/annotations"

  initialize : (models, options) ->

    @userId = options.userId
    @dataSetName = options.dataSetName

  parse : (response) ->
    if @dataSetName
      return _.filter(response, dataSetName : @dataSetName)
    else
      return response


module.exports = UserAnnotationCollection
