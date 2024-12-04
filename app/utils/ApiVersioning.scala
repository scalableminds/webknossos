package utils

import play.api.mvc.RequestHeader

trait ApiVersioning {

  protected def CURRENT_API_VERSION: Int = 9

  protected def OLDEST_SUPPORTED_API_VERSION: Int = 5

  protected def isInvalidApiVersion(request: RequestHeader): Boolean = {
    val requestedVersion = extractRequestedApiVersion(request)
    requestedVersion > CURRENT_API_VERSION || requestedVersion < OLDEST_SUPPORTED_API_VERSION
  }

  protected def invalidApiVersionMessage(request: RequestHeader): String = {
    val requestedVersion = extractRequestedApiVersion(request)
    f"This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested $requestedVersion but must be at least $OLDEST_SUPPORTED_API_VERSION and at most $CURRENT_API_VERSION."
  }

  private def extractRequestedApiVersion(request: RequestHeader): Int =
    "^/api/v(\\d+).*$".r.findFirstMatchIn(request.uri) match {
      case Some(m) =>
        m.group(1).toInt
      case None => CURRENT_API_VERSION
    }
}
