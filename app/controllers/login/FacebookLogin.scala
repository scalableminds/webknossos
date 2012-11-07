package controllers.login
import play.api.mvc._
import views._
import java.net.URLEncoder
import play.api.libs.ws.WS
import com.restfb.BaseFacebookClient
import com.restfb.DefaultFacebookClient
import play.api.Play
import brainflight.security.Secured
import controllers.UserController
import play.api.libs.concurrent.execution.defaultContext
//import scala.concurrent.ExecutionContext.Implicits.global

object FacebookLogin extends Controller {
  val conf = Play.current.configuration

  val REDIRECT_URL =
    conf.getString("facebook.redirectHost").getOrElse("http://localhost") + "/login/fb/code"

  val FACEBOOK = "https://www.facebook.com"

  val PERMISSIONS = "email"

  val FBAppId =
    conf.getString("facebook.appId") get

  val FBAppSecret =
    conf.getString("facebook.appSecret") get

  val accesTokenRegex = "(?<=access_token=)([^&]*)"r

  val FACEBOOK_AUTHORIZATION =
    "%s/dialog/oauth?scope=%s&client_id=%s&redirect_uri=%s".format(
      FACEBOOK,
      PERMISSIONS,
      FBAppId,
      URLEncoder.encode(REDIRECT_URL, "UTF-8"))

  def facebookAcessTokenUrl(code: String) =
    "https://graph.facebook.com/oauth/access_token?client_id=%s&redirect_uri=%s&client_secret=%s&code=%s".format(
      FBAppId,
      URLEncoder.encode(REDIRECT_URL, "UTF-8"),
      FBAppSecret,
      code)

  def login = Action {
    Redirect(FACEBOOK_AUTHORIZATION)
  }

  def loginCode(code: String) = Action { response =>
    Async {
      WS.url(facebookAcessTokenUrl(code)).get().map { reponse =>
        try {
          val accessToken = accesTokenRegex.findFirstIn(response.body.asText.get).getOrElse("")
          val facebookClient = new DefaultFacebookClient(accessToken);
          val meObject =
            facebookClient.fetchObject("me", classOf[com.restfb.types.User]);

          val user = models.user.User.authRemote(meObject.getEmail, "facebook") getOrElse (
            models.user.User.createRemote(
              meObject.getEmail,
              meObject.getFirstName,
              meObject.getLastName,
              "facebook"))

          UserController.dashboard(response)
            .withSession(Secured.createSession(user))
        } catch {
          case (e) => BadRequest("Failed to login.")
        }
      }
    }
  }
}