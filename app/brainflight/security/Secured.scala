package brainflight.security

import models.user.User
import play.api.mvc._
import play.api.mvc.BodyParsers
import play.api.mvc.Results._
import play.api.mvc.Request
import play.api.Play
import play.api.mvc.WebSocket
import play.api.mvc.WebSocket._
import play.api.Play.current
import play.api.libs.iteratee.Input
import controllers.routes
import play.api.libs.iteratee.Done
import models.security.Role
import models.security.Permission
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.Iteratee
import play.api.libs.iteratee.Concurrent

case class AuthenticatedRequest[A](
  val user: User, request: Request[A]
) extends WrappedRequest(request)

object Secured {
  /**
   * Key used to store authentication information in the client cookie
   */
  val SessionInformationKey = "userId"
    
  /**
   * Creates a map which can be added to a cookie to set a session
   */
  def createSession( user: User ): Tuple2[String, String] =
    ( SessionInformationKey -> user.id )
}

/**
 * Provide security features
 */
trait Secured {
  /**
   * Defines the access role which is used if no role is passed to an
   * authenticated action
   */
  def DefaultAccessRole: Option[Role] = None

  /**
   * Defines the default permission used for authenticated actions if not
   * specified otherwise
   */
  def DefaultAccessPermission: Option[Permission] = None
    
  /**
   * Tries to extract the user from a request
   */
  def maybeUser( implicit request: RequestHeader ): Option[User] = {
    for {
      userId <- userId( request )
      user <- User.findOneById( userId )
    } yield user
  }
  /**
   * Retrieve the connected users email address.
   */
  private def userId( request: RequestHeader ) = {
    request.session.get( Secured.SessionInformationKey ) match {
      case Some( id ) =>
        Some( id )
      case _ if Play.configuration.getBoolean( "application.enableAutoLogin" ).get =>
        // development setting: if the above key is set, one gets logged in 
        // automatically
        Some( User.default.id )  
      case _ =>
        None
    }
  }

  /**
   * Awesome construct to create an authenticated action. It uses the helper
   * function defined below this one to ensure that a user is logged in. If
   * a user fails this check he is redirected to the result of 'onUnauthorized'
   *
   * Example usage:
   *   def initialize = Authenticated( role=Admin ) { user =>
   *     implicit request =>
   *       Ok("User is logged in!")
   *   }
   *
   */

  def Authenticated[A](
    parser: BodyParser[A],
    role: Option[Role] = DefaultAccessRole,
    permission: Option[Permission] = DefaultAccessPermission )(f: AuthenticatedRequest[A] => Result) = {
      Action(parser) { request =>
        maybeUser(request).map { user =>
           if ( hasAccess( user, role, permission ) ) 
             f(AuthenticatedRequest(user, request))
           else
             Forbidden(views.html.error.defaultError("You don't have enough permissions to access this site. Sorry :( \n If you recently registered, contact an admin to verify your account.",Some(user)))
        }.getOrElse( onUnauthorized(request) )      
    }
  }

  def Authenticated(f: AuthenticatedRequest[AnyContent] => Result): Action[AnyContent]  = {
    Authenticated(BodyParsers.parse.anyContent)(f)
  }

  def AuthenticatedWebSocket[A](
    role: Option[Role] = DefaultAccessRole,
    permission: Option[Permission] = DefaultAccessPermission )( f: => User => RequestHeader => ( Iteratee[A, _], Enumerator[A] ) )( implicit formatter: FrameFormatter[A] ) =
    WebSocket.using[A] { request =>
      ( for {
        user <- maybeUser( request )
        if ( hasAccess( user, role, permission ) )
      } yield {
        f( user )( request )
      } ).getOrElse {
        val iteratee = Done[A, Unit]( (), Input.EOF )
        // Send an error and close the socket
        val (enumerator, channel) = Concurrent.broadcast[A]
        channel.eofAndEnd

        ( iteratee, enumerator )
      }
    }

  def hasAccess( user: User, role: Option[Role], permission: Option[Permission] ) =
    ( role.isEmpty || user.hasRole( role.get ) ) &&
      ( permission.isEmpty || user.hasPermission( permission.get ) )
  /**
   * Redirect to login if the user in not authorized.
   */
  private def onUnauthorized( request: RequestHeader ) =
    Results.Redirect( routes.Application.login )

  // --

  /**
   * Action for authenticated users.
   */
  def IsAuthenticated( f: => String => Request[AnyContent] => Result ) =
    Security.Authenticated( userId, onUnauthorized ) {
      user =>
        Action( request => f( user )( request ) )
    }

}
