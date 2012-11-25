package brainflight.view

import views.html.helper.FieldConstructor

trait BootstrapHelpers {
    
  implicit val bootsrapFields = FieldConstructor(views.html.BootstrapFieldConstructor.f)    
    
}