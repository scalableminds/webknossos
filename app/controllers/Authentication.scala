package controllers

import play.api._
import play.api.mvc.Action
import play.api.data._
import play.api.Play.current
import play.api.libs.concurrent._
import models.user._
import views._
import play.mvc.Results.Redirect
import play.api.data.Forms._
import models._
import play.api.libs.iteratee.Done
import play.api.libs.iteratee.Input
import brainflight.security.Secured
import brainflight.mail._
import controllers.admin._
import models.tracing.Tracing
import models.tracing.UsedTracings
import brainflight.thirdparty.BrainTracing
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import braingames.mvc.Controller

object Authentication extends Controller with Secured {
  // -- Authentication
  override def DefaultAccessRole = None

  val autoVerify =
    Play.configuration.getBoolean("application.enableAutoVerify") getOrElse false

  val registerForm: Form[(String, String, String, String)] = {

    def registerFormApply(user: String, firstName: String, lastName: String, password: Tuple2[String, String]) =
      (user, firstName, lastName, password._1)

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
        "password" -> passwordField)(registerFormApply)(registerFormUnapply)
        .verifying("user.email.alreadyInUse",
          user => User.findLocalByEmail(user._1).isEmpty))
  }

  def register = Action {
    implicit request =>
      Ok(html.user.register(registerForm))
  }

  /**
   * Handle registration form submission.
   */
  def registrate = Action { implicit request =>
    Async {
      registerForm.bindFromRequest.fold(
        formWithErrors =>
          Promise.pure(BadRequest(html.user.register(formWithErrors))),
        {
          case (email, firstName, lastName, password) => {
            val user =
              User.create(email, firstName, lastName, password, autoVerify)

            BrainTracing.register(user, password).map { brainDBresult =>
              Application.Mailer ! Send(
                DefaultMails.registerMail(user.name, email, brainDBresult))
              if (autoVerify) {
                Redirect(routes.Game.index)
                  .withSession(Secured.createSession(user))
              } else {
                Redirect(routes.Authentication.login)
                  .flashing("success" -> "An account has been created. An administrator is going to unlock you soon.")
              }
            }
          }
        })
    }
  }

  val loginForm = Form(
    tuple(
      "email" -> text,
      "password" -> text) verifying ("user.login.failed", result => result match {
        case (email, password) =>
          User.auth(email, password).isDefined
      }))

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
      loginForm.bindFromRequest.fold(
        formWithErrors =>
          BadRequest(html.user.login(formWithErrors)),
        userForm => {
          val user = User.findLocalByEmail(userForm._1).get
          Redirect(routes.Game.index)
            .withSession(Secured.createSession(user))
        })
  }

  /**
   * Logout and clean the session.
   */
  def logout = Action {
    Redirect(routes.Authentication.login)
      .withNewSession
      .flashing("success" -> Messages("user.login.success"))
  }
}