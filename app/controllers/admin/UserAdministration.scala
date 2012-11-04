package controllers.admin

import controllers.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user.User
import controllers.Application
import brainflight.mail.Send
import brainflight.mail.DefaultMails
import models.security.Role
import play.api.libs.json.Json
import play.api.templates.Html
import play.api.i18n.Messages

object UserAdministration extends Controller with Secured {
  override val DefaultAccessRole = Role( "admin" )
  
  def index = Authenticated { implicit request =>
    Ok(html.admin.user.userAdministration(request.user, User.findAll))

  }

  def verifyUser(userId: String) = Authenticated { implicit request =>
    User.findOneById(userId) match {
      case Some(user) =>
        Application.Mailer ! Send( DefaultMails.verifiedMail(user.name, user.email) )
        AjaxOk(html.admin.user.userTableItem(User.verify(user)), user.name + Messages("user.verified"))
      case _ =>
        BadRequest
    }
  }
  
    def deleteUser(userId: String) = Authenticated { implicit request =>
    User.findOneById(userId) match {
      case Some(user) =>
        User.remove(user)
        AjaxOk(user.name + Messages("user.deleted"))
      case _ =>
        BadRequest
    }
  }
}