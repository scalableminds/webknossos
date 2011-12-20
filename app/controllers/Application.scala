package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current

import models._
import views._

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
          Redirect(routes.Projects.index).withSession("email" -> user._1)
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
        user => Redirect(routes.Projects.index).withSession("email" -> user._1)
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
        Projects.add, Projects.delete, Projects.rename,
        Projects.addGroup, Projects.deleteGroup, Projects.renameGroup,
        Projects.addUser, Projects.removeUser, Tasks.addFolder,
        Tasks.renameFolder, Tasks.deleteFolder, Tasks.index,
        Tasks.add, Tasks.update, Tasks.delete
      )
    ).as("text/javascript")
  }

}

/**
 * Provide security features
 */
trait Secured {
  def user(implicit request: RequestHeader) = {
    request.session.get("email") match {
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
    if (Play.configuration.getBoolean("application.enableAutoLogin").get)
      Some("scmboy@scalableminds.com")
    else
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

  /**
   * Check if the connected user is a member of this project.
   */
  def IsMemberOf(project: String)(f: => String => Request[AnyContent] => Result) = IsAuthenticated {
    user => request =>
      if (Project.isMember(project, user)) {
        f(user)(request)
      } else {
        Results.Forbidden
      }
  }

  /**
   * Check if the connected user is a owner of this task.
   */
  def IsOwnerOf(task: String)(f: => String => Request[AnyContent] => Result) = IsAuthenticated {
    user => request =>
      if (Task.isOwner(task, user)) {
        f(user)(request)
      } else {
        Results.Forbidden
      }
  }

}

