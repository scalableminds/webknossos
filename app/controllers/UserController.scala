package controllers

import brainflight.security.Secured
import play.api.mvc.Controller
import models.User
import play.api.mvc.Action
import play.api.mvc.Request
import play.api.libs.json.Json._
import play.api.libs.json.JsValue
import play.api.libs.json._
import models.Role
import models.UserConfiguration

object UserController extends Controller with Secured{
  override val DefaultAccessRole = Role.User
  
  def verify( validationKey: String ) = Action {
    implicit request =>
      if( User.verify( validationKey ) ) 
        Ok("Thanks for your registration.") 
      else 
        BadRequest( "Unknown validation key." )
  }
 
  
  def saveSettings = Authenticated(parser = parse.json){
    implicit request =>
      request.body.asOpt[JsObject] map { settings =>
        val fields = settings.fields filter UserConfiguration.isValidSetting
        User.save( request.user.copy( configuration = UserConfiguration( fields.toMap ) ) )
        Ok
      } getOrElse ( BadRequest )
  }
  
  def showSettings = Authenticated{
    implicit request =>
      Ok( toJson( request.user.configuration.settings ) )
  }
}