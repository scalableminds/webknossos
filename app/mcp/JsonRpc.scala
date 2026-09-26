package mcp

import play.api.libs.json.*

/** Minimal JSON-RPC 2.0 envelope, as used by the MCP Streamable HTTP transport. Note that JSON-RPC batching is
  * deliberately not supported, it was removed in MCP revision 2025-06-18.
  */
case class JsonRpcRequest(id: Option[JsValue], method: String, params: JsObject) {
  // A request without an id is a notification: the client does not expect a response.
  def isNotification: Boolean = id.isEmpty
}

case class JsonRpcError(code: Int, message: String)

object JsonRpcError {
  val parseErrorCode = -32700
  val invalidRequestCode = -32600
  val methodNotFoundCode = -32601
  val invalidParamsCode = -32602
  val internalErrorCode = -32603

  def parseError(message: String): JsonRpcError = JsonRpcError(parseErrorCode, message)
  def invalidRequest(message: String): JsonRpcError = JsonRpcError(invalidRequestCode, message)
  def methodNotFound(method: String): JsonRpcError = JsonRpcError(methodNotFoundCode, s"Method not found: $method")
  def invalidParams(message: String): JsonRpcError = JsonRpcError(invalidParamsCode, message)
  def internalError(message: String): JsonRpcError = JsonRpcError(internalErrorCode, message)
}

object JsonRpc {

  private val version = "2.0"

  def parseRequest(body: JsValue): Either[JsonRpcError, JsonRpcRequest] = body match {
    case _: JsArray =>
      Left(JsonRpcError.invalidRequest("Batched JSON-RPC requests are not supported"))
    case obj: JsObject =>
      (obj \ "method").asOpt[String] match {
        case None         => Left(JsonRpcError.invalidRequest("Missing or invalid field: method"))
        case Some(method) =>
          Right(
            JsonRpcRequest(
              id = (obj \ "id").toOption.filterNot(_ == JsNull),
              method = method,
              params = (obj \ "params").asOpt[JsObject].getOrElse(Json.obj())
            )
          )
      }
    case _ => Left(JsonRpcError.invalidRequest("Request must be a JSON object"))
  }

  def result(id: Option[JsValue], result: JsValue): JsObject =
    Json.obj("jsonrpc" -> version, "id" -> id.getOrElse[JsValue](JsNull), "result" -> result)

  def error(id: Option[JsValue], error: JsonRpcError): JsObject =
    Json.obj(
      "jsonrpc" -> version,
      "id" -> id.getOrElse[JsValue](JsNull),
      "error" -> Json.obj("code" -> error.code, "message" -> error.message)
    )
}
