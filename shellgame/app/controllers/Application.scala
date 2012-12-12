package controllers

import play.api._
import play.api.mvc._
import java.io.File
import play.api.mvc.BodyParsers._
import java.io.FileWriter
import play.api.Play.current
object Application extends controllers.Controller {
  
  def shellgameAssets(file: String) = 
    controllers.Assets.at(path="/shellgame-assets", file)

  def index = Action {
    Ok(views.html.index("Your new application is ready."))
  }

}