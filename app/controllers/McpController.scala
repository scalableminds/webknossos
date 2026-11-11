package controllers

import com.scalableminds.util.box.{Empty, Failure, Full}
import mcp.{JsonRpc, JsonRpcError, McpService}
import oauth.{OAuthGrant, OAuthService}
import models.user.User
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Request, RequestHeader, Result}
import security.TokenHeaders
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

/** Model Context Protocol (MCP) server, so that AI agents can work with this WEBKNOSSOS instance.
  *
  * The transport is Streamable HTTP without server-to-client streaming: every POST carries a single JSON-RPC message
  * and is answered with a single JSON response. The server is stateless, so no Mcp-Session-Id is issued and GET (which
  * clients use to open an SSE stream) is answered with 405, as allowed by the spec.
  *
  * Clients authenticate with an OAuth access token (Authorization: Bearer), see oauth.OAuthService. Nothing else is
  * accepted here: no session cookie and no API token. A request without a valid token is answered with 401 and a
  * WWW-Authenticate header pointing to the protected resource metadata, which is how clients discover where to log in.
  */
class McpController @Inject() (
    mcpService: McpService,
    oauthService: OAuthService,
    conf: WkConf
)(implicit
    ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers
) extends Controller {

  private val protocolVersionHeader = "MCP-Protocol-Version"

  def handle(): Action[JsValue] = Action.async(bodyParsers.tolerantJson) { implicit request =>
    if (!conf.Features.mcpEnabled) Future.successful(NotFound)
    else
      authenticate(request).flatMap {
        case Left(rejection)      => Future.successful(rejection)
        case Right((user, grant)) =>
          rejectionFor(request) match {
            case Some(rejection) => Future.successful(rejection)
            case None            =>
              mcpService.handle(request.body, user, grant).map {
                case Some(response) => Ok(response)
                case None           => Accepted // JSON-RPC notifications are not answered
              }
          }
      }
  }

  def handleGet(): Action[AnyContent] = Action { _ =>
    if (conf.Features.mcpEnabled) MethodNotAllowed else NotFound
  }

  private def authenticate(request: Request[?]): Future[Either[Result, (User, OAuthGrant)]] =
    TokenHeaders.bearerToken(request) match {
      case None              => Future.successful(Left(unauthorized(None)))
      case Some(accessToken) =>
        oauthService.authenticateAccessToken(accessToken).futureBox.map {
          case Full(userAndGrant) => Right(userAndGrant)
          case Empty              => Left(unauthorized(Some("invalid_token")))
          case failure: Failure   =>
            logger.warn(s"Checking an MCP access token failed: ${failure.msg}")
            Left(InternalServerError(Json.obj("error" -> "server_error")))
        }
    }

  // RFC 6750 and RFC 9728: tells the client where to find out how to get a token.
  private def unauthorized(error: Option[String]): Result = {
    val parameters = List(
      Some(s"""resource_metadata="${oauthService.protectedResourceMetadataUrl}""""),
      Some(s"""scope="${OAuthService.defaultLevel}""""),
      error.map(e => s"""error="$e"""")
    ).flatten
    Unauthorized(Json.obj("error" -> error.getOrElse[String]("unauthorized")))
      .withHeaders(WWW_AUTHENTICATE -> s"Bearer ${parameters.mkString(", ")}")
  }

  private def rejectionFor(request: RequestHeader): Option[Result] =
    if (!request.contentType.contains(JSON))
      // Checked here rather than by the json body parser, which would answer with an HTML error page.
      Some(
        UnsupportedMediaType(
          JsonRpc
            .error(None, JsonRpcError.invalidRequest("Unsupported Media Type: Content-Type must be application/json"))
        )
      )
    else if (request.headers.get(ORIGIN).exists(_ != oauthService.instanceOrigin))
      // Browsers send an Origin header, MCP clients usually do not. A foreign origin means that a web page tries to
      // talk to the server (DNS rebinding). Rejecting it is required by the spec.
      Some(Forbidden(JsonRpc.error(None, JsonRpcError.invalidRequest("Invalid Origin header"))))
    else
      request.headers.get(protocolVersionHeader) match {
        // Clients send the negotiated version on every request after initialization. The spec requires a 400 for
        // unsupported ones. Without the header, the server is to assume 2025-03-26, which needs no special handling.
        case Some(version) if !mcpService.supportedProtocolVersions.contains(version) =>
          Some(BadRequest(JsonRpc.error(None, JsonRpcError.invalidRequest(s"Unsupported protocol version: $version"))))
        case _ => None
      }
}
