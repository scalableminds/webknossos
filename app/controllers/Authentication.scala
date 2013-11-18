package controllers

import play.api._
import play.api.mvc.{Request, Action}
import play.api.data._
import play.api.Play.current
import play.api.libs.concurrent._
import models.user._
import play.mvc.Results.Redirect
import play.api.data.Forms._
import models._
import views.html
import play.api.libs.iteratee.Done
import play.api.libs.iteratee.Input
import oxalis.security.Secured
import braingames.mail._
import controllers.admin._
import oxalis.thirdparty.BrainTracing
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import models.tracing.skeleton.SkeletonTracing
import oxalis.view.{ProvidesUnauthorizedSessionData, UnAuthedSessionData}
import scala.concurrent.Future

object Authentication extends Controller with Secured with ProvidesUnauthorizedSessionData {
  // -- Authentication
  override def DefaultAccessRole = None

  val autoVerify =
    Play.configuration.getBoolean("application.enableAutoVerify") getOrElse false

  val registerForm: Form[(String, String, String, String)] = {

    def registerFormApply(email: String, firstName: String, lastName: String, password: Tuple2[String, String]) =
      (email.toLowerCase, firstName, lastName, password._1)

    def registerFormUnapply(user: (String, String, String, String)) =
      Some((user._1, user._2, user._3, ("", "")))

    val passwordField = tuple("main" -> text, "validation" -> text)
      .verifying("user.password.nomatch", pw => pw._1 == pw._2)
      .verifying("user.password.tooshort", pw => pw._1.length >= 6)

    Form(
      mapping(
        "email" -> email,
        "firstName" -> nonEmptyText(1, 30),
        "lastName" -> nonEmptyText(1, 30),
        "password" -> passwordField)(registerFormApply)(registerFormUnapply))
  }

  def register = Action {
    implicit request =>
      Ok(html.user.register(registerForm))
  }

  /**
   * Handle registration form submission.
   */
  def registrate = Action {
    implicit request =>
      Async {
        registerForm.bindFromRequest.fold(
        formWithErrors =>
          Future.successful(BadRequest(html.user.register(formWithErrors))), {
          case (email, firstName, lastName, password) => {
            UserService.findOneByEmail(email).flatMap {
              case None =>
                for {
                  user <- UserService.insert(email, firstName, lastName, password, autoVerify)
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
  def authenticate = Action {
    implicit request =>
      Async {
        loginForm.bindFromRequest.fold(
        formWithErrors =>
          Future.successful(BadRequest(html.user.login(formWithErrors))), {
          case (email, password) =>
            for {
              user <- UserService.auth(email.toLowerCase, password) ?~> Messages("user.login.failed")
            } yield {
              Redirect(controllers.routes.Application.index)
                .withSession(Secured.createSession(user))
            }
        })
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
