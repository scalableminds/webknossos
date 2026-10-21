package controllers

import mcp.{McpBundleService, McpService}
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonAutoFormat
import models.user.UserService
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{Scope, ShortLivedTokenService, WkEnv}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class McpPermissions(scopes: String) derives JsonAutoFormat

/** Model Context Protocol (MCP) server, so that AI agents can work with this WEBKNOSSOS instance.
  *
  * The transport is Streamable HTTP without server-to-client streaming: every POST carries a single JSON-RPC message
  * and is answered with a single JSON response. The server is stateless, so no Mcp-Session-Id is issued and GET (which
  * clients use to open an SSE stream) is answered with 405, as allowed by the spec.
  *
  * Authentication is the regular WEBKNOSSOS token auth, via the X-Auth-Token or the Authorization: Bearer header. Note
  * that unauthenticated requests are answered by silhouette's default error handler, which does not send a
  * WWW-Authenticate challenge header, so clients need to be configured with the token explicitly.
  */
class McpController @Inject() (
    mcpService: McpService,
    mcpBundleService: McpBundleService,
    shortLivedTokenService: ShortLivedTokenService,
    userService: UserService,
    sil: Silhouette[WkEnv]
)(implicit
    ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers
) extends Controller {

  def handle(): Action[JsValue] = sil.SecuredAction.async(bodyParsers.tolerantJson) { implicit request =>
    mcpService.handle(request.body, request.identity).map {
      case Some(response) => Ok(response)
      case None           => Accepted // JSON-RPC notifications are not answered
    }
  }

  def handleGet(): Action[AnyContent] = sil.SecuredAction { _ =>
    MethodNotAllowed
  }

  /** Revokes all short-lived tokens the current user has been issued. Needed because the scopes of a token are fixed
    * when it is created: narrowing the permissions of a connection only affects tokens issued afterwards, so an agent
    * that already holds one keeps its old permissions until it expires.
    */
  def revokeTokens(): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- shortLivedTokenService.revokeAllForUser(request.identity._id)
    } yield Ok
  }

  def readPermissions(): Action[AnyContent] = sil.SecuredAction { implicit request =>
    Ok(Json.obj("scopes" -> request.identity.mcpAgentScopes))
  }

  def updatePermissions(): Action[McpPermissions] = sil.SecuredAction.fox(validateJson[McpPermissions]) {
    implicit request =>
      for {
        _ <- Fox.fromBool(Scope.Set.isParsable(request.body.scopes)) ?~> "Invalid permissions"
        _ <- userService.updateMcpAgentScopes(request.identity, request.body.scopes)
      } yield Ok(Json.obj("scopes" -> request.body.scopes))
  }

  // The bundle contains no secrets (the user enters their token when installing it), so it needs no authentication.
  def bundle(scopes: Option[String]): Action[AnyContent] = Action { _ =>
    Ok(mcpBundleService.bundleBytes(scopes))
      .as("application/octet-stream")
      .withHeaders(CONTENT_DISPOSITION -> s"""attachment; filename="${mcpBundleService.fileName}"""")
  }
}
