package mcp

import com.typesafe.scalalogging.LazyLogging
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.json.McpJsonMapper
import io.modelcontextprotocol.server.McpStatelessServerHandler
import io.modelcontextprotocol.server.transport.{
  HeaderAccessor,
  ServerHttpHeaderValidator,
  ServerTransportSecurityException
}
import io.modelcontextprotocol.spec.{McpSchema, McpStatelessServerTransport}
import play.api.http.{ContentTypes, Status}
import play.api.libs.json.{JsNull, Json}
import play.api.mvc.{Headers, Result, Results}
import reactor.core.publisher.Mono

import java.io.IOException
import java.util
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.*
import scala.jdk.FutureConverters.*

/** Stateless Streamable HTTP transport for the MCP Java SDK, on top of Play.
  *
  * The SDK only ships servlet and Spring transports, so this mirrors its HttpServletStatelessServerTransport: every POST
  * carries a single JSON-RPC message and is answered with a single JSON response, no sessions are issued and there is
  * no server-to-client stream. The protocol itself (initialization, version negotiation, tools/list, tools/call, tool
  * input validation) is handled by the SDK's McpStatelessAsyncServer, which registers itself here via setMcpHandler.
  *
  * Unlike the servlet transport, this one does not insist on `Accept: application/json, text/event-stream`. The spec
  * asks clients to send it, but some (e.g. simple stdio-to-HTTP bridges) only send application/json, and since this
  * transport never streams, the answer is application/json either way.
  */
class PlayMcpTransport(jsonMapper: McpJsonMapper, headerValidator: ServerHttpHeaderValidator)
    extends McpStatelessServerTransport
    with LazyLogging {

  @volatile private var mcpHandler: Option[McpStatelessServerHandler] = None
  @volatile private var isClosing = false

  override def setMcpHandler(handler: McpStatelessServerHandler): Unit =
    mcpHandler = Some(handler)

  override def closeGracefully(): Mono[Void] = Mono.fromRunnable(() => isClosing = true)

  /** Handles one POSTed message. The context is handed to the tool handlers, see McpService for what it carries. */
  def handlePost(body: String, contentType: Option[String], headers: Headers, context: McpTransportContext)(implicit
      ec: ExecutionContext
  ): Future[Result] =
    mcpHandler match {
      case None                    => Future.successful(Results.ServiceUnavailable("MCP server is not initialized"))
      case Some(_) if isClosing    => Future.successful(Results.ServiceUnavailable("Server is shutting down"))
      case Some(handler)           =>
        validateHeaders(headers) match {
          case Some(securityError) => Future.successful(Results.Status(securityError.getStatusCode)(securityError.getMessage))
          case None if !contentType.exists(_.equalsIgnoreCase(ContentTypes.JSON.split(";").head)) =>
            Future.successful(
              errorResult(
                Status.UNSUPPORTED_MEDIA_TYPE,
                McpSchema.ErrorCodes.INVALID_REQUEST,
                "Unsupported Media Type: Content-Type must be application/json"
              )
            )
          case None => dispatch(handler, body, context)
        }
    }

  private def dispatch(handler: McpStatelessServerHandler, body: String, context: McpTransportContext)(implicit
      ec: ExecutionContext
  ): Future[Result] =
    parseMessage(body) match {
      case Left(errorResult) => Future.successful(errorResult)
      case Right(request: McpSchema.JSONRPCRequest) =>
        withContext(handler.handleRequest(context, request), context).asScala
          .map(response => Results.Ok(jsonMapper.writeValueAsString(response)).as(ContentTypes.JSON))
          .recover { case e: Exception => internalError("Failed to handle request", e) }
      case Right(notification: McpSchema.JSONRPCNotification) =>
        withContext(handler.handleNotification(context, notification), context).asScala
          .map(_ => Results.Accepted)
          .recover { case e: Exception => internalError("Failed to handle notification", e) }
      case Right(_) =>
        Future.successful(
          errorResult(
            Status.BAD_REQUEST,
            McpSchema.ErrorCodes.INVALID_REQUEST,
            "The server accepts either requests or notifications"
          )
        )
    }

  // The SDK reads the context from the reactor context as well, so it is put there like the servlet transport does.
  private def withContext[T](mono: Mono[T], context: McpTransportContext) =
    mono.contextWrite(ctx => ctx.put(McpTransportContext.KEY, context)).toFuture

  // A JSON array (batch) is rejected here as well: batching was removed from MCP in revision 2025-06-18.
  private def parseMessage(body: String): Either[Result, McpSchema.JSONRPCMessage] =
    try Right(McpSchema.deserializeJsonRpcMessage(jsonMapper, body))
    catch {
      case e: IllegalArgumentException =>
        Left(errorResult(Status.BAD_REQUEST, McpSchema.ErrorCodes.INVALID_REQUEST, s"Invalid message: ${e.getMessage}"))
      case _: IOException =>
        Left(errorResult(Status.BAD_REQUEST, McpSchema.ErrorCodes.PARSE_ERROR, "Could not parse the message as JSON"))
    }

  private def validateHeaders(headers: Headers): Option[ServerTransportSecurityException] =
    try {
      headerValidator.validate(PlayHeaderAccessor(headers))
      None
    } catch { case e: ServerTransportSecurityException => Some(e) }

  private def internalError(what: String, e: Exception): Result = {
    logger.error(s"$what: ${e.getMessage}", e)
    errorResult(Status.INTERNAL_SERVER_ERROR, McpSchema.ErrorCodes.INTERNAL_ERROR, s"$what: ${e.getMessage}")
  }

  /* Answered with a JSON-RPC error envelope. The id is unknown here, which JSON-RPC expresses as null. Written with
   * play-json, since the SDK's JSONRPCResponse insists on an id. */
  private def errorResult(httpStatus: Int, code: Int, message: String): Result =
    Results
      .Status(httpStatus)(
        Json.obj("jsonrpc" -> "2.0", "id" -> JsNull, "error" -> Json.obj("code" -> code, "message" -> message))
      )
}

private case class PlayHeaderAccessor(headers: Headers) extends HeaderAccessor {
  override def getHeaderNames(): util.List[String] = headers.keys.toList.asJava
  override def getHeader(name: String): util.List[String] = headers.getAll(name).asJava
}
