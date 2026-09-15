package controllers

import mcp.McpService
import play.silhouette.api.Silhouette
import play.api.libs.json.JsValue
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/**
  * Model Context Protocol (MCP) server, so that AI agents can work with this WEBKNOSSOS instance.
  *
  * The transport is Streamable HTTP without server-to-client streaming: every POST carries a single JSON-RPC message
  * and is answered with a single JSON response. The server is stateless, so no Mcp-Session-Id is issued and GET
  * (which clients use to open an SSE stream) is answered with 405, as allowed by the spec.
  *
  * Authentication is the regular WEBKNOSSOS token auth, via the X-Auth-Token or the Authorization: Bearer header.
  * Note that unauthenticated requests are answered by silhouette's default error handler, which does not send a
  * WWW-Authenticate challenge header, so clients need to be configured with the token explicitly.
  */
class McpController @Inject() (mcpService: McpService, sil: Silhouette[WkEnv])(implicit
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
}
