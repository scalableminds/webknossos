package controllers

import play.api._
import play.api.mvc.{Request, Action}
import play.api.data._
import play.api.Play.current
import models.user._
import play.api.data.Forms._
import views.html
import oxalis.security.Secured
import braingames.mail._
import oxalis.thirdparty.BrainTracing
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import oxalis.view.{ProvidesUnauthorizedSessionData, UnAuthedSessionData}
import scala.concurrent.Future
import models.team.TeamDAO
import braingames.reactivemongo.DBAccessContext

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
      .verifying("user.password.tooshort", pw => pw._1.length >= 6)

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
      for {
        teams <- TeamDAO.findAll(DBAccessContext(None))
      } yield Ok(html.user.register(registerForm, teams))
  }

  /**
   * Handle registration form submission.
   */
  def handleRegistration = Action.async {
    implicit request =>
      registerForm.bindFromRequest.fold(
      formWithErrors =>
        for {
          teams <- TeamDAO.findAll(DBAccessContext(None))
        } yield BadRequest(html.user.register(formWithErrors, teams)), {
        case (team, email, firstName, lastName, password) => {
          UserService.findOneByEmail(email).flatMap {
            case None =>
              for {
                user <- UserService.insert(team, email, firstName, lastName, password, autoVerify)
                brainDBResult <- BrainTracing.register(user, password)
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
                    .flashing("modal" -> "An account has been created. An administrator is going to unlock you soon.")
                }
              }
            case Some(_) =>
              Future.successful(JsonBadRequest(Messages("user.email.alreadyInUse")))
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
          for {
            user <- UserService.auth(email.toLowerCase, password) ?~> Messages("user.login.failed")
          } yield {
            val redirectLocation =
            if(user.verified)
              controllers.routes.Application.index
            else
              controllers.routes.UserController.dashboard
            Redirect(redirectLocation).withSession(Secured.createSession(user))
          }
      })
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
