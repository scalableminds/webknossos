package controllers

import brainflight.security.Secured
import play.api.mvc.Controller
import models.User
import play.api.mvc.Action
import play.api.mvc.Request
import play.api.libs.json.Json._
import play.api.libs.json._
import models.Role
import models.UserConfiguration

object UserController extends Controller with Secured{
  override val DefaultAccessRole = Role( "user" )

  def saveSettings = Authenticated(parser = parse.json){ user =>
    implicit request =>
      ( for( settings <- request.body.asOpt[Map[String,String]] ) yield {
        User.save( user.copy( configuration = UserConfiguration(settings) ) )
        Ok
      }) getOrElse ( BadRequest )
  }
  
  def showSettings = Authenticated(){ user =>
    implicit request =>
      Ok( toJson( user.configuration.settings ) )
  }
}