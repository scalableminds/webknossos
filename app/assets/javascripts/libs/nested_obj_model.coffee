### define
underscore : _
backbone : Backbone
###

class NestedObjModel extends Backbone.Model
  get: (attributeString) ->
    attributes = attributeString.split(".")
    valueObj = this.attributes
    _.reduce(
      attributes
      (value, attribute) ->
        value[attribute]
      valueObj)
