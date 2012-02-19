package controllers
import play.api.mvc._
import views._
import java.net.URLEncoder
import play.api.libs.ws.WS
import com.restfb.BaseFacebookClient
import com.restfb.DefaultFacebookClient
import play.api.Play.current
import play.api.Play

object FacebookLogin extends Controller {
  
  val REDIRECT_URL = 
    Play.configuration.getString("facebook.redirectHost").getOrElse("http://localhost") + "/login/fb/code"
    
  val FACEBOOK = "https://www.facebook.com"

  val PERMISSIONS = "email"

  val FBAppId =
    Play.configuration.getString( "facebook.appId" ) get

  val FBAppSecret =
    Play.configuration.getString( "facebook.appSecret" ) get

  val accesTokenRegex = "(?<=access_token=)([^&]*)"r

  val FACEBOOK_AUTHORIZATION =
    "%s/dialog/oauth?scope=%s&client_id=%s&redirect_uri=%s".format(
      FACEBOOK,
      PERMISSIONS,
      FBAppId,
      URLEncoder.encode( REDIRECT_URL, "UTF-8" ) )

  def facebookAcessTokenUrl( code: String ) =
    "https://graph.facebook.com/oauth/access_token?client_id=%s&redirect_uri=%s&client_secret=%s&code=%s".format(
      FBAppId,
      URLEncoder.encode( REDIRECT_URL, "UTF-8" ),
      FBAppSecret,
      code )

  def login = Action {
    Redirect( FACEBOOK_AUTHORIZATION )
  }

  def loginCode( code: String ) = Action { response =>
    val ws = WS.url( facebookAcessTokenUrl( code ) ).get().value
    val accessToken = accesTokenRegex.findFirstIn( ws.get.body ).getOrElse( "" )
    try {
      val facebookClient = new DefaultFacebookClient( accessToken );
      val meObject =
        facebookClient.fetchObject( "me", classOf[com.restfb.types.User] );

      val user = models.User.authRemote( meObject.getEmail, "facebook" ) match {
        case Some( user ) =>
          user
        case None =>
          models.User.createRemote(
            meObject.getEmail,
            meObject.getFirstName + " " + meObject.getLastName,
            "facebook" )
      }
      Ok( html.test.index( user ) ).withSession( "email" -> user.email )
    } catch {
      case ( e ) => BadRequest( "Failed to login." )
    }
  }
}