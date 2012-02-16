package controllers

import play.api.mvc.Action._
import views.html
import play.api.mvc.{Action, Controller}
import models.User
import brainflight.security.Secured

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 12.12.11
 * Time: 00:23
 */
object Test  extends Controller with Secured{
  def index = Action { implicit request =>
    user match{
      case Some( u ) => 
        Ok(html.test.index(u))
      case _ =>
        Redirect(routes.Application.login)
    }
  }

  def demo = Action { implicit request =>
    Ok(html.test.demo())
  }

  def geo = Action { implicit request =>
    Ok(html.test.geo())
  }
  def tests = Action { implicit request =>
    Ok(html.test.tests())
  }
}