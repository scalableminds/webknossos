package brainflight.security

import models.User
import play.api.mvc._
import play.api.mvc.BodyParsers
import play.api.mvc.Results._
import play.api.mvc.Request
import play.api.Play
import play.api.Play.current
import play.api.libs.iteratee.Input
import controllers.routes
import play.api.libs.iteratee.Done
import models.{ Role, Permission }

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
  val DefaultAccessRole: Option[Role] = None

  /**
   * Defines the default permission used for authenticated actions if not
   * specified otherwise
   */
  val DefaultAccessPermission: Option[Permission] = None

  /**
   * Tries to extract the user from a request
   */
  def maybeUser( implicit request: RequestHeader ): Option[models.User] = {
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
        Some( User.findLocalByEmail( "scmboy@scalableminds.com" ).get.id )
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
    parser: BodyParser[A] = BodyParsers.parse.anyContent,
    role: Option[Role] = DefaultAccessRole,
    permission: Option[Permission] = DefaultAccessPermission )( f: => User => Request[A] => Result ): Action[( Action[A], A )] = Authenticated( userId, role, permission, onUnauthorized ) {
    user =>
      Action( parser )( request => f( user )( request ) )
  }

  def Authenticated[A](
    username: RequestHeader => Option[String],
    role: Option[Role],
    permission: Option[Permission],
    onUnauthorized: RequestHeader => Result )( action: User => Action[A] ): Action[( Action[A], A )] = {

    val authenticatedBodyParser = BodyParser { request =>
      maybeUser( request ).map { user =>
        if ( ( role.isEmpty || user.hasRole( role.get ) ) &&
          ( permission.isEmpty || user.hasPermission( permission.get ) ) ) {

          val innerAction = action( user )
          innerAction.parser( request ).mapDone { body =>
            body.right.map( innerBody => ( innerAction, innerBody ) )
          }
        } else {
          val input: Input[Array[Byte]] = Input.Empty
          Done( Left( Forbidden ), input )
        }
      }.getOrElse {
        Done( Left( onUnauthorized( request ) ), Input.Empty )
      }
    }

    Action( authenticatedBodyParser ) { request =>
      val ( innerAction, innerBody ) = request.body
      innerAction( request.map( _ => innerBody ) )
    }
  }

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
