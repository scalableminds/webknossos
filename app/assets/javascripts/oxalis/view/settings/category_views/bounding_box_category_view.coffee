### define
./category_view : CategoryView
../setting_views/text_input_setting_view : TextInputSettingView
###

class boundingBoxCategory extends CategoryView


  caption : "Bounding Box"


  subviewCreators :

    "boundingbox" : ->

      return new TextInputSettingView(
        model : @model
        options :
          name : "boundingBox"
          displayName : "Bounding Box"
          pattern : "(\\d*\\s*,\\s*){5}\\d*"
      )


