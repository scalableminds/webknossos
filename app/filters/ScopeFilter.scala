package filters

import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.stream.Materializer
import play.api.libs.json.Json
import play.api.mvc.{Filter, RequestHeader, Result}
import play.api.mvc.Results.{Forbidden, InternalServerError, Unauthorized}
import play.api.routing.Router
import com.scalableminds.util.mvc.TokenHeaders
import security.{RouteScopes, Scope, ScopeSet, ScopedApiToken, ScopedApiTokenService}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

/** Enforces the scopes of scoped tokens (see security.Scope) for all /api routes.
  *
  * Requests that are not authenticated by a scoped token pass through untouched, so session cookies and regular API
  * tokens behave exactly as before. Scoped tokens are the scoped API tokens of security.ScopedApiTokenService. They are
  * recognized by the prefix of their value, so only requests that actually use one pay for the extra database lookup. A
  * value with that prefix that is not a valid scoped API token is rejected, it never counts as unscoped.
  *
  * Note that only the authentication headers are inspected, never the ?token= query parameter: on wk routes that
  * parameter carries a token that is the *subject* of the request (as in validateUserAccess) rather than its
  * credential. Datastore and tracingstore routes are not covered here at all, they are scoped in
  * UserTokenController.validateUserAccess.
  */
class ScopeFilter @Inject() (scopedApiTokenService: ScopedApiTokenService)(implicit
    val mat: Materializer,
    ec: ExecutionContext
) extends Filter
    with LazyLogging {

  override def apply(nextFilter: RequestHeader => Future[Result])(request: RequestHeader): Future[Result] = {
    val scopedApiTokenValues = scopedApiTokenValuesOf(request)
    if (scopedApiTokenValues.isEmpty) nextFilter(request)
    else
      findAllValid(scopedApiTokenValues).flatMap {
        case Empty =>
          // Fail closed: a value with the scoped prefix that does not resolve to a valid scoped API token (expired,
          // revoked, or its grant revoked) must never be treated as an unscoped token. The regular authentication
          // might still accept it, e.g. if revoking the grant did not get to deleting its tokens.
          logger.info(s"Denying ${request.method} ${request.path}: invalid scoped API token")
          Future.successful(
            Unauthorized(Json.obj("messages" -> Json.arr(Json.obj("error" -> "Invalid or expired token."))))
          )
        case failure: Failure =>
          // Fail closed here too: we could not check.
          logger.warn(s"Could not look up scoped token for ${request.method} ${request.path}: ${failure.msg}")
          Future.successful(
            InternalServerError(Json.obj("messages" -> Json.arr(Json.obj("error" -> "Could not check token scopes."))))
          )
        case Full(tokens) =>
          // The scopes come from the tokens' grants rather than the tokens, so that changing them takes effect at once.
          // See ScopedApiTokenService for how its cache keeps it that way.
          requiredScopeFor(request) match {
            case None =>
              deny(request, tokens.head.scopes, "This endpoint cannot be used with a scoped token")
            case Some(required) =>
              tokens.find(!_.scopes.allows(required)) match {
                case Some(token) => deny(request, token.scopes, s"Missing scope $required")
                case None        => nextFilter(request)
              }
          }
      }
  }

  /** All token headers are checked, not just the one the authentication picks (see CombinedAuthenticatorService). If
    * any of them holds a scoped API token, the request is scoped. Adding a second header can then never lift the
    * restriction, even if the two ever disagree about which header counts.
    */
  private def scopedApiTokenValuesOf(request: RequestHeader): List[String] =
    if (!request.path.startsWith("/api/")) List.empty
    else TokenHeaders.allTokenValues(request).filter(scopedApiTokenService.looksLikeScopedApiTokenValue)

  // Empty if any of the values is not a valid scoped API token. Failure means the lookup itself failed.
  private def findAllValid(tokenValues: List[String]): Future[Box[List[ScopedApiToken]]] =
    tokenValues match {
      case Nil          => Future.successful(Full(List.empty))
      case head :: tail =>
        scopedApiTokenService.findValid(head).futureBox.flatMap {
          case Full(token)      => findAllValid(tail).map(_.map(token :: _))
          case Empty            => Future.successful(Empty)
          case failure: Failure => Future.successful(failure)
        }
    }

  private def requiredScopeFor(request: RequestHeader): Option[Scope] =
    request.attrs.get(Router.Attrs.HandlerDef).flatMap { handlerDef =>
      RouteScopes.requiredScope(handlerDef.controller, handlerDef.method, request.method)
    }

  private def deny(request: RequestHeader, effectiveScopes: ScopeSet, reason: String): Future[Result] = {
    logger.info(s"Denying ${request.method} ${request.path} for scoped token (scopes $effectiveScopes): $reason")
    Future.successful(
      Forbidden(Json.obj("messages" -> Json.arr(Json.obj("error" -> s"Not allowed for this token. $reason"))))
    )
  }
}
