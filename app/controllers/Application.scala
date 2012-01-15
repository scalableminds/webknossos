package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import models._
import views._
import play.mvc.Results.Redirect

object Application extends Controller {

  // -- Authentication

  val registerForm = Form(
    of(
      "email" -> email,
      "password" -> text,
      "repassword" -> text
    ) verifying("Passwords do not match", result => result match {
      case (_, password, repassword) => password == repassword
    })
  )

  def register = Action {
    implicit request =>
      Ok(html.register(registerForm))
  }

  /**
   * Handle registration form submission.
   */
  def registrate = Action {
    implicit request =>
      registerForm.bindFromRequest.fold(
        formWithErrors => BadRequest(html.register(formWithErrors)),
        user => {
          println(user)
          User.create(User(user._1, user._2, user._2, false))
          Redirect(routes.Test.index).withSession("email" -> user._1)
        }
      )
  }

  val loginForm = Form(
    of(
      "email" -> text,
      "password" -> text
    ) verifying("Invalid email or password", result => result match {
      case (email, password) => User.authenticate(email, password).isDefined
    })
  )

  /**
   * Login page.
   */
  def login = Action {
    implicit request =>
      Ok(html.login(loginForm))
  }

  /**
   * Handle login form submission.
   */
  def authenticate = Action {
    implicit request =>
      loginForm.bindFromRequest.fold(
        formWithErrors => BadRequest(html.login(formWithErrors)),
        user => Redirect(routes.Test.index).withSession("email" -> user._1)
      )
  }

  /**
   * Logout and clean the session.
   */
  def logout = Action {
    Redirect(routes.Application.login).withNewSession.flashing(
      "success" -> "You've been logged out"
    )
  }

  // -- Javascript routing

  def javascriptRoutes = Action {
    import routes.javascript._
    Ok(
      Routes.javascriptRouter("jsRoutes")(
          //fill in stuff which should be able to be called from js
      )
    ).as("text/javascript")
  }

}

/**
 * Provide security features
 */
trait Secured {
  def user(implicit request: RequestHeader) = {
    username(request) match {
      case Some(mail) => User.findByEmail(mail)
      case _ => None
    }
  }

  def userId(implicit request: RequestHeader) = {
    user match {
      case Some(u) => u._id
      case _ => throw new Exception("not logged in")
    }
  }

  /**
   * Retrieve the connected user email.
   */
  private def username(request: RequestHeader) = {
    if (Play.configuration.getBoolean("application.enableAutoLogin").get){
      Some("scmboy@scalableminds.com")
    }else
      request.session.get("email")
  }

  /**
   * Redirect to login if the user in not authorized.
   */
  private def onUnauthorized(request: RequestHeader) = Results.Redirect(routes.Application.login)

  // --

  /**
   * Action for authenticated users.
   */
  def IsAuthenticated(f: => String => Request[AnyContent] => Result) = Security.Authenticated(username, onUnauthorized) {
    user =>
      Action(request => f(user)(request))
  }

}

