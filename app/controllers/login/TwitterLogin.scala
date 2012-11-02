package controllers.login

import views._

import play.Logger
import play.api._
import play.api.libs.ws._
import play.api.libs.oauth._
import play.api.mvc._
import play.api.libs.json
import play.api.libs.json.Json._
import play.api.libs._
import play.api.libs.concurrent._
import play.api.libs.iteratee._
import com.ning.http.client.Realm.AuthScheme
import brainflight.security.Secured
import play.api.libs.concurrent.execution.defaultContext
//import scala.concurrent.ExecutionContext.Implicits.global

object TwitterLogin extends Controller {

  val UserInformationURL = "https://api.twitter.com/1/account/verify_credentials.json?skip_status=true"
  // OAuth

  val KEY = ConsumerKey( "xo4kwjFHv4BcnVOs2zK4A",
    "QgTAxFEhfNL4TJnAnATlNgZLlPLyuDSIbaRgcinvEs" )

  val TWITTER = OAuth( ServiceInfo(
    "https://api.twitter.com/oauth/request_token",
    "https://api.twitter.com/oauth/access_token",
    "https://api.twitter.com/oauth/authorize", KEY ) )

  def login = Action { request =>
    request.queryString.get( "oauth_verifier" ).flatMap( _.headOption ).map { verifier =>
      val tokenPair = sessionTokenPair( request ).get
      // We got the verifier; now get the access token, store it and back to index
      TWITTER.retrieveAccessToken( tokenPair, verifier ) match {
        case Right( t ) => {
          // We received the unauthorized tokens in the OAuth object - store it before we proceed
          authUser( t )
        }
        case Left( e ) => throw e
      }
    }.getOrElse(
      TWITTER.retrieveRequestToken( "http://brainflight.net/login/tw" ) match {
        case Right( t ) => {
          // We received the unauthorized tokens in the OAuth object - store it before we proceed
          Redirect( TWITTER.redirectUrl( t.token ) ).withSession( "token" -> t.token, "secret" -> t.secret )
        }
        case Left( e ) => throw e
      } )
  }

  def authUser( tokens: RequestToken ) = Async {

    WS.url( UserInformationURL )
      .sign( OAuthCalculator( KEY, tokens ) )
      .get().map( response => {
        val name = ( response.json \ "name" ).as[String]
        val email = ( response.json \ "screen_name" ).as[String] + "@TWITTER"
        
        val user = models.User.authRemote( email, "twitter" ) getOrElse (
          models.User.createRemote( email, name, "twitter" ) )
          
        Redirect( controllers.routes.Application.index() ).withSession( Secured.createSession(user) )
      } )
  }

  def sessionTokenPair( implicit request: RequestHeader ): Option[RequestToken] = {
    for {
      token <- request.session.get( "token" )
      secret <- request.session.get( "secret" )
    } yield {
      RequestToken( token, secret )
    }
  }

}