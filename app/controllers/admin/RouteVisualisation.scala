package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.User

object RouteVisualisation extends Controller with Secured{
  def index = Authenticated(){ user => implicit request =>
    Ok( html.admin.index( user, User.findAll ) )
  }
}