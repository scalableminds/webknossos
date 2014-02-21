### define
underscore : _
backbone : Backbone
###

class TeamModel extends Backbone.Collection

  constructor : ->

    super(
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

