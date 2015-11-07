package oxalis.security

import scala.concurrent.Future

import akka.actor.Props
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import controllers.routes
import models.user.{User, UserService}
import net.liftweb.common.{Empty, Full}
import oxalis.user.{ActivityMonitor, UserActivity}
import oxalis.view.AuthedSessionData
import play.api.Play
import play.api.Play.current
import play.api.i18n.Messages
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Results._
import play.api.mvc.{Request, _}

class AuthenticatedRequest[A](
  val user: User, override val request: Request[A]
  ) extends UserAwareRequest(Some(user), request)

class UserAwareRequest[A](
  val userOpt: Option[User], val request: Request[A]
  ) extends WrappedRequest(request)


object Secured {
  /**
   * Key used to store authentication information in the client cookie
   */
  val SessionInformationKey = "userId"

  val ActivityMonitor = Akka.system.actorOf(Props[ActivityMonitor], name = "activityMonitor")

  /**
   * Creates a map which can be added to a cookie to set a session
   */
  def createSession(user: User): Tuple2[String, String] =
    (SessionInformationKey -> user.id)
}

/**
 * Provide security features
 */
trait Secured extends FoxImplicits {
  /**
   * Defines the access role which is used if no role is passed to an
   * authenticated action
   */
  val userService = models.user.UserService

  /**
   * Tries to extract the user from a request
   */
  def maybeUser(implicit request: RequestHeader): Fox[User] =
    userFromSession orElse userFromToken orElse autoLoginUser

  private def autoLoginUser: Fox[User] = {
    // development setting: if the key is set, one gets logged in automatically
    if (Play.configuration.getBoolean("application.enableAutoLogin").get)
      UserService.defaultUser
    else
      Fox.empty
  }

  private def userFromToken(implicit request: RequestHeader): Fox[User] =
    request.getQueryString("loginToken") match {
      case Some(token) =>
        userService.authByToken(token)(GlobalAccessContext)
      case _ =>
        Empty
    }

  private def userFromSession(implicit request: RequestHeader): Fox[User] =
    request.session.get(Secured.SessionInformationKey) match {
      case Some(id) =>
        userService.findOneById(id, useCache = true)(GlobalAccessContext)
      case _ =>
        Empty
    }

  /**
   * Awesome construct to create an authenticated action. It uses the helper
   * function defined below this one to ensure that a user is logged in. If
   * a user fails this check he is redirected to the result of 'onUnauthorized'
   *
   * Example usage:
   * def initialize = Authenticated( role=Admin ) { user =>
   * implicit request =>
   * Ok("User is logged in!")
   * }
   *
   */
  trait AuthHelpers {
    def executeAndEnsureSession[A](user: User, request: Request[A], block: (AuthenticatedRequest[A]) => Future[SimpleResult]): Future[SimpleResult] =
      if (request.session.get(Secured.SessionInformationKey).isDefined)
        block(new AuthenticatedRequest(user, request))
      else
        block(new AuthenticatedRequest(user, request)).map { r =>
          r.withSession(Secured.createSession(user))
        }
  }

  object Authenticated extends ActionBuilder[AuthenticatedRequest] with AuthHelpers{
    def invokeBlock[A](request: Request[A], block: (AuthenticatedRequest[A]) => Future[SimpleResult]) = {
      maybeUser(request).flatMap { user =>
        Secured.ActivityMonitor ! UserActivity(user, System.currentTimeMillis)
        if (user.verified)
          executeAndEnsureSession(user, request, block)
        else
          Future.successful(Forbidden(views.html.error.defaultError(Messages("user.notVerified"), false)(AuthedSessionData(user, request.flash))))
      }.getOrElse(onUnauthorized(request))
    }
  }

  object UserAwareAction extends ActionBuilder[UserAwareRequest] with AuthHelpers{
    def invokeBlock[A](request: Request[A], block: (UserAwareRequest[A]) => Future[SimpleResult]) = {
      maybeUser(request).filter(_.verified).futureBox.flatMap {
        case Full(user) =>
          Secured.ActivityMonitor ! UserActivity(user, System.currentTimeMillis)
          executeAndEnsureSession(user, request, block)
        case _ =>
          block(new UserAwareRequest(None, request))
      }
    }
  }

  /**
   * Redirect to login if the user in not authorized.
   */
  private def onUnauthorized(request: RequestHeader) =
    Results.Redirect(routes.Authentication.login)
}
