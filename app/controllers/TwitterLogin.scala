package controllers

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

object TwitterLogin extends Controller {

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
      TWITTER.retrieveRequestToken( "http://localhost:9000/login/tw" ) match {
        case Right( t ) => {
          // We received the unauthorized tokens in the OAuth object - store it before we proceed
          Redirect( TWITTER.redirectUrl( t.token ) ).withSession( "token" -> t.token, "secret" -> t.secret )
        }
        case Left( e ) => throw e
      } )
  }
  def authUser( tokens: RequestToken ) = Async {

    WS.url( "https://api.twitter.com/1/account/verify_credentials.json?skip_status=true" )
      .sign( OAuthCalculator( KEY, tokens ) )
      .get().map( response => {
        val name = (response.json \ "name").as[String]
        val screen_name = (response.json \ "screen_name").as[String]
        val user = models.User.authRemote( screen_name+"@TWITTER.COM" , "twitter" ) match {
          case Some( user ) =>
            user
          case None =>
            models.User.createRemote(
              screen_name+"@TWITTER.COM",
              name,
              "twitter" )
        }
        Redirect( routes.Test.index() ).withSession( "userId" -> user.id )
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