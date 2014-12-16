### define
oxalis/constants : constants
./category_view : CategoryView
../setting_views/number_setting_view : NumberSettingView
../setting_views/button_setting_view : ButtonSettingView
###

class CellCategoryView extends CategoryView


  caption : "Cells"


  subviewCreators :

    "activeCellId" : ->

      return new NumberSettingView(
        model : @model
        options :
          name : "activeCellId"
          displayName : "Active Cell ID"
      )

    "createCell" : ->

      return new ButtonSettingView(
        model : @model
        options :
          displayName : "Create new Cell"
          callbackName : "createCell"
      )
