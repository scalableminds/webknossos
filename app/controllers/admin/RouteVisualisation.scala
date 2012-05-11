package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.User
import models.Role

object RouteVisualisation extends Controller with Secured{
  // TODO remove comment in production
  // override val DefaultAccessRole = Role( "admin" )
  
  def index = Authenticated{ implicit request =>
    Ok( html.admin.index( request.user, User.findAll ) )
  }
}