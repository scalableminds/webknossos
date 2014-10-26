### define
underscore : _
backbone : backbone
###

class CommentsCollection extends Backbone.Collection


  intitalize : ->

    @coefficient = 1

  comparator : (model) ->

    return model.get("node") * @coefficient


  sort : (isAscending) ->

    @coefficient = if isAscending then 1 else -1
    super()
