### define 
jquery : $
../../libs/toast : Toast
./modal : modal
../view : View
###

class SkeletonTracingView extends View

  constructor : (@model) ->

    super(@model)

    $('#comments-tree').hide()