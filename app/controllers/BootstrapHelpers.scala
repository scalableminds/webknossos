package controllers

import views.html.helper.FieldConstructor

object BootstrapHelpers {
    
  implicit val bootsrapFields = FieldConstructor(views.html.BootstrapFieldConstructor.f)    
    
}