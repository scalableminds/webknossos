_               = require("lodash")
backbone        = require("backbone")
AnnotationModel = require("./annotation_model")

class AnnotationCollection extends Backbone.Collection

  model : AnnotationModel

  constructor : (taskId) ->

    @url = "/api/tasks/#{taskId}/annotations"
    super()

module.exports = AnnotationCollection
