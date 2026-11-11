package security

import play.api.http.HeaderNames
import play.api.mvc.RequestHeader

/** Where a request carries its API token. Authentication (CombinedAuthenticatorService) and scope enforcement
  * (filters.ScopeFilter) must agree on this, otherwise a request could be authenticated by a token the filter never
  * looked at, and so skip its scope check.
  */
object TokenHeaders {
  // Read by silhouette's BearerTokenAuthenticatorService (its default fieldName, headers only).
  val authTokenHeader = "X-Auth-Token"

  private val bearerPrefix = "Bearer "

  def authToken(request: RequestHeader): Option[String] =
    request.headers.get(authTokenHeader)

  def bearerToken(request: RequestHeader): Option[String] =
    request.headers.get(HeaderNames.AUTHORIZATION).map(_.trim).collect {
      case header if header.toLowerCase.startsWith(bearerPrefix.toLowerCase) =>
        header.drop(bearerPrefix.length).trim
    }

  // The Authorization header is only consulted if X-Auth-Token is absent, not if it holds an unknown token.
  def credential(request: RequestHeader): Option[String] =
    authToken(request).orElse(bearerToken(request))

  // Every token value the request carries, so that the scope check can not be dodged by adding a second header.
  def allTokenValues(request: RequestHeader): List[String] =
    (authToken(request).toList ++ bearerToken(request).toList).distinct
}
