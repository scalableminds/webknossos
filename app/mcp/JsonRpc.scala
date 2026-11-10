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
      for {
        _ <- Either.cond(
          (obj \ "jsonrpc").asOpt[String].contains(version),
          (),
          JsonRpcError.invalidRequest(s"Missing or invalid field: jsonrpc, must be \"$version\"")
        )
        method <- (obj \ "method").asOpt[String].toRight(JsonRpcError.invalidRequest("Missing or invalid field: method"))
        id <- parseId(obj)
        params <- (obj \ "params").toOption match {
          case None                 => Right(Json.obj())
          case Some(params: JsObject) => Right(params)
          // JSON-RPC also allows positional (array) params, but MCP only uses named ones.
          case Some(_) => Left(JsonRpcError.invalidParams("Invalid field: params, must be an object"))
        }
      } yield JsonRpcRequest(id, method, params)
    case _ => Left(JsonRpcError.invalidRequest("Request must be a JSON object"))
  }

  /* Only a missing id makes a notification. JSON-RPC allows strings and numbers as ids. It also allows null, but
   * discourages it, and MCP forbids it. */
  private def parseId(obj: JsObject): Either[JsonRpcError, Option[JsValue]] =
    (obj \ "id").toOption match {
      case None                              => Right(None)
      case Some(id @ (_: JsString | _: JsNumber)) => Right(Some(id))
      case Some(_) => Left(JsonRpcError.invalidRequest("Invalid field: id, must be a string or a number"))
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
