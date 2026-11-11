package controllers

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, JsonAutoFormat}
import com.scalableminds.util.tools.Fox.toFox
import oauth.{AuthorizationError, OAuthService}
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, RequestHeader}
import play.silhouette.api.Silhouette
import security.WkEnv
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class OAuthAuthorizeRequest(params: Map[String, String], level: String, approved: Boolean) derives JsonAutoFormat

/** The OAuth authorization server that MCP clients use to connect, see oauth.OAuthService.
  *
  * The consent page itself is the frontend route /oauth/authorize, which is also the authorization endpoint. It shows
  * what getAuthorizationRequest returns and submits the user's decision to authorize. Both need a logged-in user, the
  * frontend shows the login form first if needed.
  *
  * Nothing here is reachable with scoped tokens (see security.RouteScopes), so an agent can never approve or revoke
  * connections.
  */
class OAuthController @Inject() (
    oauthService: OAuthService,
    conf: WkConf,
    sil: Silhouette[WkEnv]
)(implicit
    ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers
) extends Controller {

  import OAuthService.levels

  private def assertEnabled: Fox[Unit] =
    Fox.fromBool(conf.Features.mcpEnabled) ?~> "The MCP server is not enabled on this instance." ~> NOT_FOUND

  // The metadata documents and the token endpoint involve no cookies, so any web page may read them.
  private val corsHeaders = Seq("Access-Control-Allow-Origin" -> "*")
  private val noStoreHeaders = Seq(CACHE_CONTROL -> "no-store", PRAGMA -> "no-cache")

  // RFC 8414. Clients look this up at the issuer, which is the root of this instance.
  def authorizationServerMetadata(): Action[AnyContent] = Action.fox { _ =>
    for {
      _ <- assertEnabled
    } yield Ok(
      Json.obj(
        "issuer" -> oauthService.issuer,
        "authorization_endpoint" -> oauthService.authorizationEndpoint,
        "token_endpoint" -> oauthService.tokenEndpoint,
        "registration_endpoint" -> oauthService.registrationEndpoint,
        "response_types_supported" -> Json.arr("code"),
        "grant_types_supported" -> Json.arr("authorization_code", "refresh_token"),
        "code_challenge_methods_supported" -> Json.arr("S256"),
        "token_endpoint_auth_methods_supported" -> Json.arr("none"),
        "scopes_supported" -> levels.map(_.toString),
        "client_id_metadata_document_supported" -> true,
        "authorization_response_iss_parameter_supported" -> true
      )
    ).withHeaders(corsHeaders*)
  }

  // RFC 9728. Served both at the root and with the resource path appended, clients try both.
  def protectedResourceMetadata(): Action[AnyContent] = Action.fox { _ =>
    for {
      _ <- assertEnabled
    } yield Ok(
      Json.obj(
        "resource" -> oauthService.mcpResource,
        "authorization_servers" -> Json.arr(oauthService.issuer),
        "scopes_supported" -> levels.map(_.toString),
        "bearer_methods_supported" -> Json.arr("header"),
        "resource_name" -> "WEBKNOSSOS"
      )
    ).withHeaders(corsHeaders*)
  }

  /** What the consent page shows: which client asks, and for which permission level. Takes the query parameters of the
    * authorization request as they are.
    */
  def getAuthorizationRequest: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    val params = request.queryString.collect { case (key, value +: _) => key -> value }
    for {
      _ <- assertEnabled
      validation <- Fox.fromFuture(oauthService.validateAuthorizationRequest(params))
    } yield validation match {
      case Left(error)      => Ok(errorJson(error))
      case Right(validated) =>
        Ok(
          Json.obj(
            "isValid" -> true,
            "clientId" -> validated.client.clientId,
            "clientName" -> validated.client.clientName,
            "isRegisteredClient" -> validated.client.isRegistered,
            "redirectUri" -> validated.redirectUri,
            "requestedLevel" -> validated.requestedLevel.toString
          )
        )
    }
  }

  /** The user's decision. Returns where to send the browser: back to the client, with a code or an error. */
  def authorize(): Action[OAuthAuthorizeRequest] = sil.SecuredAction.fox(validateJson[OAuthAuthorizeRequest]) {
    implicit request =>
      for {
        _ <- assertEnabled
        // The session cookie is SameSite=Lax, so a foreign page could not send it anyway. This is defense in depth
        // against a user being tricked into approving a connection.
        _ <- Fox.fromBool(!isCrossOrigin(request)) ?~> "Invalid Origin header" ~> FORBIDDEN
        validation <- Fox.fromFuture(oauthService.validateAuthorizationRequest(request.body.params))
        result <- validation match {
          case Left(error)                                => Fox.successful(Ok(errorJson(error)))
          case Right(validated) if !request.body.approved =>
            Fox.successful(Ok(redirectJson(oauthService.denyRedirect(validated))))
          case Right(validated) =>
            for {
              level <- OAuthService.levelFromString(request.body.level).toFox ?~> "Invalid permission level"
              redirectUrl <- oauthService.approve(request.identity, validated, level)
            } yield Ok(redirectJson(redirectUrl))
        }
      } yield result
  }

  private def errorJson(error: AuthorizationError): JsObject =
    Json.obj("isValid" -> false, "error" -> error.message, "redirectUrl" -> error.redirectUrl)

  private def redirectJson(redirectUrl: String): JsObject =
    Json.obj("isValid" -> true, "redirectUrl" -> redirectUrl)

  private def isCrossOrigin(request: RequestHeader): Boolean =
    request.headers.get(ORIGIN).exists(_ != oauthService.instanceOrigin)

  // RFC 6749 section 3.2. Clients send form-encoded parameters and do not authenticate (public clients with PKCE).
  def token(): Action[Map[String, Seq[String]]] = Action.fox(bodyParsers.formUrlEncoded) { request =>
    val params = request.body.collect { case (key, value +: _) => key -> value }
    for {
      _ <- assertEnabled
      outcome <- oauthService.handleTokenRequest(params)
    } yield outcome match {
      case Right(tokens) => Ok(tokens).withHeaders(corsHeaders ++ noStoreHeaders*)
      case Left(error)   => BadRequest(error.toJson).withHeaders(corsHeaders ++ noStoreHeaders*)
    }
  }

  /* RFC 7591. Open to anyone, as the MCP spec intends: a registration alone grants nothing, the user still has to
   * approve the client on the consent page. Registrations that are never approved are cleaned up. */
  def register(): Action[JsValue] = Action.fox(bodyParsers.tolerantJson(maxRegistrationBytes)) { request =>
    for {
      _ <- assertEnabled
      outcome <- oauthService.registerClient(request.body)
    } yield outcome match {
      case Right(registration) => Created(registration).withHeaders(corsHeaders ++ noStoreHeaders*)
      case Left(error)         => BadRequest(error.toJson).withHeaders(corsHeaders ++ noStoreHeaders*)
    }
  }

  private val maxRegistrationBytes = 16 * 1024

  // The connections of the current user, for the account settings.
  def listGrants(): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- assertEnabled
      grants <- oauthService.listGrants(request.identity)
    } yield Ok(Json.toJson(grants.map { grant =>
      Json.obj(
        "id" -> grant._id,
        "clientId" -> grant.clientId,
        "clientName" -> grant.clientName,
        "level" -> grant.scopes,
        "created" -> grant.created,
        "lastUsed" -> grant.lastUsed
      )
    }))
  }

  def revokeGrant(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- assertEnabled
      _ <- oauthService.revokeGrantOfUser(request.identity, id)
    } yield Ok
  }
}
