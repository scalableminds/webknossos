package oxalis.security

import scala.concurrent.{Future, Promise}

import com.scalableminds.util.mvc.JsonResult
import models.user.{User, UserService}
import play.api.mvc._
import play.api.mvc.BodyParsers
import play.api.mvc.Results._
import play.api.i18n.{I18nSupport, Messages}
import play.api.mvc.Request
import play.api.{Logger, Play}
import play.api.Play.current
import controllers.routes
import play.api.libs.concurrent.Akka
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
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import models.team.Role
import play.api.http.Status._
import scala.concurrent.duration._
import scala.util.Success

import akka.actor.Props
import akka.pattern.after
import com.newrelic.api.agent.NewRelic
import play.airbrake.Airbrake

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
trait Secured extends FoxImplicits with I18nSupport{
  /**
   * Defines the access role which is used if no role is passed to an
   * authenticated action
   */
  val userService = models.user.UserService

  val longRequestWarningTime = 10.seconds

  /**
   * Tries to extract the user from a request
   */
  def maybeUser(implicit request: RequestHeader): Fox[User] =
    userFromToken orElse userFromSession orElse autoLoginUser

  private def autoLoginUser: Fox[User] = {
    // development setting: if the key is set, one gets logged in automatically
    if (Play.configuration.getBoolean("application.authentication.enableDevAutoLogin").get)
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

  private def withLongRunningOpTracking[A](f: => Future[A])(implicit request: Request[_]): Future[A] = {
    val start = System.currentTimeMillis
    val longRunningAlert = Promise[Boolean]()

    // Schedule a warning if the processing continues longer than the warn limit
    after(longRequestWarningTime, Akka.system.scheduler)(Future.successful{
      if(!longRunningAlert.isCompleted)
        Logger.warn(
          s"Running long running request (ID:${request.id}):" +
          s" ${request.method.toUpperCase} ${request.uri}")
    })

    val result = f

    // Schedule another warning if the processing of a long request is completed
    result.onComplete{ r =>
      longRunningAlert.complete(Success(true))
      val end = System.currentTimeMillis
      if((end - start).millis > longRequestWarningTime){
        Logger.warn(
          f"Completed long running Request (ID: ${request.id}%s, T: ${(end-start).toDouble / 1000}%.2fs): " +
          s"${request.method.toUpperCase} ${request.uri}")
      }
    }
    result
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
    def executeAndEnsureSession[A](user: User, request: Request[A], block: (AuthenticatedRequest[A]) => Future[Result]): Future[Result] =
      if (request.session.get(Secured.SessionInformationKey).contains(user.id))
        block(new AuthenticatedRequest(user, request))
      else
        block(new AuthenticatedRequest(user, request)).map { r =>
          r.withSession(Secured.createSession(user))
        }
  }

  object Authenticated extends ActionBuilder[AuthenticatedRequest] with AuthHelpers{
    def invokeBlock[A](request: Request[A], block: (AuthenticatedRequest[A]) => Future[Result]) = {
      withLongRunningOpTracking {
        maybeUser(request).flatMap { user =>
          Secured.ActivityMonitor ! UserActivity(user, System.currentTimeMillis)
          NewRelic.addCustomParameter("user-mail", user.email)
          if (user.verified)
            executeAndEnsureSession(user, request, block)
          else
            Future.successful(Forbidden(views.html.error.defaultError(Messages("user.notVerified"), false)(AuthedSessionData(user, request.flash))))
        }.getOrElse(onUnauthorized(request))
      }(request)
    }
  }

  object UserAwareAction extends ActionBuilder[UserAwareRequest] with AuthHelpers{
    def invokeBlock[A](request: Request[A], block: (UserAwareRequest[A]) => Future[Result]) = {
      withLongRunningOpTracking{
        maybeUser(request).filter(_.verified).futureBox.flatMap {
          case Full(user) =>
            NewRelic.addCustomParameter("user-mail", user.email)
            Secured.ActivityMonitor ! UserActivity(user, System.currentTimeMillis)
            executeAndEnsureSession(user, request, block)
          case _ =>
            block(new UserAwareRequest(None, request))
        }
      }(request)
    }
  }

  /**
   * Redirect to login if the user in not authorized.
   */
  private def onUnauthorized(request: RequestHeader) =
    if (request.path.startsWith("/api/"))
      new JsonResult(FORBIDDEN)(Messages("notAllowed"))
    else
      Results.Redirect(routes.Authentication.login)
  // --

  /**
   * Action for authenticated users.
    **
    *def IsAuthenticated(f: => String => Request[AnyContent] => Result) =
    *Security.Authenticated(userId, onUnauthorized) {
    *user =>
    *Action(request => f(user)(request))
    *}
   */
}
