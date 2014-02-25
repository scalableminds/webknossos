### define
underscore : _
backbone : Backbone
###

class TeamModel extends Backbone.Model

  constructor : (attributes) ->

    _.defaults(attributes,
      id: null
      name: ""
      owner: ""
      roles: [
          name : "admin"
        ,
          name: "user"
      ]
      isEditable: "true"
    )

    super(attributes)

