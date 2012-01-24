package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import models._
import views._
import play.mvc.Results.Redirect
import play.api.data.Forms._
import models._

object Application extends Controller {

  // -- Authentication

  val registerForm: Form[(String, String, String)] = Form(
    mapping(
      "email" -> email,
      "name" -> text,
      "password" -> tuple(
        "main" -> text(minLength = 6),
        "confirm" -> text
      ).verifying(
        // Add an additional constraint: both passwords must match
        "Passwords don't match", passwords => passwords._1 == passwords._2
      )
    )( (user, name, password) => (user, name, password._1) ) (  user => Some((user._1, user._2, ("",""))) ).verifying(
      // Add an additional constraint: The username must not be taken (you could do an SQL request here)
      "This username is already in use.",
      user => User.findByEmail(user._1).isEmpty
    )
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
          User.create _ tupled(user)	
          Redirect(routes.Test.index).withSession("email" -> user._1)
        }
      )
  }

  val loginForm = Form(
    tuple(
      "email" -> text,
      "password" -> text
    ) verifying("Invalid email or password", result => result match {
      case (email, password) => 
        User.authenticate(email, password).isDefined
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

