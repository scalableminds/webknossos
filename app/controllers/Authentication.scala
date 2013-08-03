package controllers

import play.api._
import play.api.mvc.Action
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
import braingames.mvc.Controller
import oxalis.mail.DefaultMails
import models.tracing.skeleton.SkeletonTracing

object Authentication extends Controller with Secured {
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
              Application.Mailer ! Send(
                DefaultMails.registerAdminNotifyerMail(user.name, email, brainDBresult))
              if (autoVerify) {
                Redirect(controllers.routes.Application.index)
                  .withSession(Secured.createSession(user))
              } else {
                Redirect(controllers.routes.Authentication.login)
                  .flashing("modal" -> "An account has been created. An administrator is going to unlock you soon.")
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
          User.auth(email.toLowerCase, password).isDefined
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
        {
          case (email, password) =>
            val user = User.findLocalByEmail(email.toLowerCase).get
            Redirect(controllers.routes.Application.index)
              .withSession(Secured.createSession(user))
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
