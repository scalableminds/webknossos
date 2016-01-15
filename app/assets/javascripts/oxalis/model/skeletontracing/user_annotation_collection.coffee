_                    = require("lodash")
Backbone             = require("backbone")

class UserAnnotationCollection extends Backbone.Collection

  url : -> "/api/users/#{@userId}/annotations"

  constructor : ({ id : @userId, @dataSetName }) ->
    super()

  parse : (response) ->
    return _.filter(response, dataSetName : @dataSetName)


module.exports = UserAnnotationCollection
