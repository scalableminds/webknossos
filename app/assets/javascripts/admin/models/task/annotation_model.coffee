### define
underscore : _
backbone : backbone
###

class AnnotationModel extends Backbone.Model

  urlRoot : "/annotations/task/"
  #idAttribute : "name"

  parse : (res) ->

    console.log res
    return res