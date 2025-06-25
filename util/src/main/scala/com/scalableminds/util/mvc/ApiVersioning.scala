package com.scalableminds.util.mvc

import play.api.libs.json.{JsObject, Json}
import play.api.mvc.RequestHeader

trait ApiVersioning {

  private lazy val CURRENT_API_VERSION: Int = 9
  private lazy val OLDEST_SUPPORTED_API_VERSION: Int = 5

  protected lazy val apiVersioningInfo: JsObject =
    Json.obj(
      "currentApiVersion" -> CURRENT_API_VERSION,
      "oldestSupportedApiVersion" -> OLDEST_SUPPORTED_API_VERSION
    )

  protected def isInvalidApiVersion(request: RequestHeader): Boolean = {
    val requestedVersion = extractRequestedApiVersion(request)
    requestedVersion > CURRENT_API_VERSION || requestedVersion < OLDEST_SUPPORTED_API_VERSION
  }

  protected def invalidApiVersionMessage(request: RequestHeader): String = {
    val requestedVersion = extractRequestedApiVersion(request)
    f"This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested $requestedVersion but must be at least $OLDEST_SUPPORTED_API_VERSION and at most $CURRENT_API_VERSION."
  }

  private def extractRequestedApiVersion(request: RequestHeader): Int =
    "^/(api|data|tracings)/v(\\d+).*$".r.findFirstMatchIn(request.uri) match {
      case Some(m) =>
        m.group(2).toInt
      case None => CURRENT_API_VERSION
    }
}
