package controllers.admin

import play.mvc.Security.Authenticated
import brainflight.security.Secured
import models.security.Role
import controllers.Controller
import views._

object LevelCreator extends Controller with Secured {
  override def DefaultAccessRole = Role.Admin
  
  def index = Authenticated { implicit request =>
    Ok(html.admin.creator.levelCreator())
  }
}