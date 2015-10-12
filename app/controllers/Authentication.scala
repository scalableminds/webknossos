package controllers

import com.scalableminds.util.security.SCrypt
import play.api._
import play.api.mvc.{Request, Action}
import play.api.data._
import play.api.Play.current
import models.user._
import play.api.data.Forms._
import views.html
import oxalis.security.Secured
import com.scalableminds.util.mail._
import oxalis.thirdparty.BrainTracing
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import oxalis.view.{SessionData, ProvidesUnauthorizedSessionData, UnAuthedSessionData}
import scala.concurrent.Future
import models.team.TeamDAO
import com.scalableminds.util.reactivemongo.DBAccessContext
import net.liftweb.common.Full

object Authentication extends Controller with Secured with ProvidesUnauthorizedSessionData {
  // -- Authentication
  val autoVerify =
    Play.configuration.getBoolean("application.enableAutoVerify") getOrElse false

  val registerForm: Form[(String, String, String, String, String)] = {

    def registerFormApply(team: String, email: String, firstName: String, lastName: String, password: Tuple2[String, String]) =
      (team, email.toLowerCase, firstName, lastName, password._1)

    def registerFormUnapply(user: (String, String, String, String, String)) =
      Some((user._1, user._2, user._3, user._4, ("", "")))

    val passwordField = tuple("main" -> text, "validation" -> text)
      .verifying("user.password.nomatch", pw => pw._1 == pw._2)
      .verifying("user.password.tooshort", pw => pw._1.length >= 8)

    Form(
      mapping(
        "team" -> text,
        "email" -> email,
        "firstName" -> nonEmptyText(1, 30),
        "lastName" -> nonEmptyText(1, 30),
        "password" -> passwordField)(registerFormApply)(registerFormUnapply))
  }

  def register = Action.async {
    implicit request =>
      formHtml(registerForm).map(Ok(_))
  }

  def formHtml(form: Form[(String, String, String, String, String)])(implicit session: SessionData) = {
    for {
      teams <- TeamDAO.findAll(DBAccessContext(None))
    } yield html.user.register(form, teams.filter(_.isRootTeam))
  }

  /**
   * Handle registration form submission.
   */
  def handleRegistration = Action.async {
    implicit request =>
      val boundForm = registerForm.bindFromRequest
      boundForm.fold(
      formWithErrors =>
        formHtml(formWithErrors).map(BadRequest(_)), {
        case (team, email, firstName, lastName, password) => {
          UserService.findOneByEmail(email).futureBox.flatMap {
            case Full(_) =>
              formHtml(boundForm.withError("email", "user.email.alreadyInUse")).map(BadRequest(_))
            case _ =>
              for {
                user <- UserService.insert(team, email, firstName, lastName, password, autoVerify)
                brainDBResult <- BrainTracing.register(user)
              } yield {
                Application.Mailer ! Send(
                  DefaultMails.registerMail(user.name, email, brainDBResult))
                Application.Mailer ! Send(
                  DefaultMails.registerAdminNotifyerMail(user.name, email, brainDBResult))
                if (autoVerify) {
                  Redirect(controllers.routes.Application.index)
                    .withSession(Secured.createSession(user))
                } else {
                  Redirect(controllers.routes.Authentication.login)
                    .flashing("modal" -> "Your account has been created. An administrator is going to unlock you soon.")
                }
              }
          }
        }
      })
  }

  val loginForm = Form(
    tuple(
      "email" -> text,
      "password" -> text))

  /**
   * Login page.
   */
  def login = Action {
    implicit request =>
      Ok(html.user.login(loginForm))
  }

  /**
   * Handle login form submission.
   */
  def authenticate = Action.async {
    implicit request =>
      loginForm.bindFromRequest.fold(
      formWithErrors =>
        Future.successful(BadRequest(html.user.login(formWithErrors))), {
        case (email, password) =>
          UserService.auth(email.toLowerCase, password).map {
            user =>
              val redirectLocation =
                if (user.verified)
                  Redirect(controllers.routes.Application.index)
                else
                  BadRequest(html.user.login(loginForm.bindFromRequest.withGlobalError("user.notVerified")))
              redirectLocation.withSession(Secured.createSession(user))

          }.getOrElse {
            BadRequest(html.user.login(loginForm.bindFromRequest.withGlobalError("user.login.failed")))
          }
      })
  }

  /**
   * Authenticate as a different user
   */
  def switchTo(email: String) = Authenticated.async {
    implicit request =>
      if(request.user.isSuperUser){
        UserService.findOneByEmail(email).map { user =>
          Logger.info(s"[Superuser] user switch (${request.user.email} -> $email)")
          Redirect(controllers.routes.Application.index).withSession(Secured.createSession(user))
        }
      } else {
        Logger.warn(s"User tried to switch (${request.user.email} -> $email) but is no Superuser!")
        Future.successful(BadRequest(html.user.login(loginForm.withGlobalError("user.login.failed"))(sessionDataAuthenticated(request))))
      }
  }

  /**
   * Logout and clean the session.
   */
  def logout = Action {
    Redirect(controllers.routes.Authentication.login)
      .withNewSession
      .flashing("success" -> Messages("user.logout.success"))
  }

}
