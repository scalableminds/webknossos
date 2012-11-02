package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user.User
import controllers.Application
import brainflight.mail.Send
import brainflight.mail.DefaultMails
import models.security.Role

object UserAdministration extends Controller with Secured {
  override val DefaultAccessRole = Role( "admin" )
  
  def index = Authenticated { implicit request =>
    Ok(html.admin.userAdministration(request.user, User.findAll))

  }

  def verifyUser(userId: String) = Authenticated { implicit request =>
    User.findOneById(userId) match {
      case Some(user) =>
        Application.Mailer ! Send( DefaultMails.verifiedMail(user.name, user.email) )
        User.verify(user)
        Ok
      case _ =>
        BadRequest
    }
  }
  
    def deleteUser(userId: String) = Authenticated { implicit request =>
    User.findOneById(userId) match {
      case Some(user) =>
        User.remove(user)
        Ok
      case _ =>
        BadRequest
    }
  }
}