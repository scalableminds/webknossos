package brainflight.security

import models.User
import play.api.mvc._
import play.api.mvc.Results._
import play.api.mvc.Request
import play.api.Play
import play.api.Play.current
import play.api.libs.iteratee.Input
import controllers.routes
import play.api.libs.iteratee.Done
import models.{ Role, Permission }

object Secured {
  val SessionInformationKey = "userId"
  
  def createSession( user: User ):Tuple2[String,String] = ( "userId" -> user.id)
}
/**
 * Provide security features
 */
trait Secured {

  val DefaultAccessRole: Option[Role] = None
  val DefaultAccessPermission: Option[Permission] = None

  def maybeUser( implicit request: RequestHeader ): Option[models.User] = {
    for {
      userId <- userId( request )
      user <- User.findOneById( userId )
    } yield user
  }

  /**
   * Retrieve the connected user email.
   */
  private def userId( request: RequestHeader ) = {
    request.session.get( Secured.SessionInformationKey ) match {
      case Some( id ) =>
        Some( id )
      case _ if Play.configuration.getBoolean( "application.enableAutoLogin" ).get =>
        Some( User.findLocalByEmail( "scmboy@scalableminds.com" ).get.id )
      case _ => 
        None
    }
  }

  def Authenticated(
    role: Option[Role] = DefaultAccessRole,
    permission: Option[Permission] = DefaultAccessPermission )( f: => User => Request[AnyContent] => Result ): Action[( Action[AnyContent], AnyContent )] = Authenticated( userId, role, permission, onUnauthorized ) {
    user =>
      Action( request => f( user )( request ) )
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
  private def onUnauthorized( request: RequestHeader ) = Results.Redirect( routes.Application.login )

  // --

  /**
   * Action for authenticated users.
   */
  def IsAuthenticated( f: => String => Request[AnyContent] => Result ) = Security.Authenticated( userId, onUnauthorized ) {
    user =>
      Action( request => f( user )( request ) )
  }

}
