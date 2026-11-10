package filters

import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.stream.Materializer
import play.api.libs.json.Json
import play.api.mvc.{Filter, RequestHeader, Result}
import play.api.mvc.Results.{Forbidden, InternalServerError}
import play.api.routing.Router
import security.{RouteScopes, Scope, ShortLivedToken, ShortLivedTokenService, TokenHeaders}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

/** Enforces the scopes of scoped tokens (see security.Scope) for all /api routes.
  *
  * Requests that are not authenticated by a scoped token pass through untouched, so session cookies and regular API
  * tokens behave exactly as before. Only short-lived tokens carry scopes today. They are recognized by the prefix of
  * their value, so only requests that actually use one pay for the extra database lookup.
  *
  * Note that only the authentication headers are inspected, never the ?token= query parameter: on wk routes that
  * parameter carries a token that is the *subject* of the request (as in validateUserAccess) rather than its
  * credential. Datastore and tracingstore routes are not covered here at all, they are scoped in
  * UserTokenController.validateUserAccess.
  */
class ScopeFilter @Inject() (
    shortLivedTokenService: ShortLivedTokenService,
    conf: WkConf
)(implicit
    val mat: Materializer,
    ec: ExecutionContext
) extends Filter
    with LazyLogging {

  override def apply(nextFilter: RequestHeader => Future[Result])(request: RequestHeader): Future[Result] =
    scopedTokenFor(request).flatMap {
      case Empty            => nextFilter(request)
      case failure: Failure =>
        // Fail closed: the request may well use a scoped token, we just could not check.
        logger.warn(s"Could not look up scoped token for ${request.method} ${request.path}: ${failure.msg}")
        Future.successful(
          InternalServerError(Json.obj("messages" -> Json.arr(Json.obj("error" -> "Could not check token scopes."))))
        )
      case Full(token) =>
        // The scopes come from the token's grant, read per request, so that changing them takes effect at once.
        requiredScopeFor(request) match {
          case None =>
            deny(request, token.scopes, "This endpoint cannot be used with a scoped token", nextFilter)
          case Some(required) if !token.scopes.allows(required) =>
            deny(request, token.scopes, s"Missing scope $required", nextFilter)
          case Some(_) => nextFilter(request)
        }
    }

  /** Empty for revoked or expired short-lived tokens as well. Such requests pass through here, but are then rejected by
    * the regular authentication, which does not find a valid token either. Failure means the lookup itself failed.
    *
    * All token headers are checked, not just the one the authentication picks (TokenHeaders.credential). If any of them
    * holds a valid short-lived token, the request is scoped. Adding a second header can then never lift the
    * restriction, even if the two ever disagree about which header counts.
    */
  private def scopedTokenFor(request: RequestHeader): Future[Box[ShortLivedToken]] =
    if (!request.path.startsWith("/api/")) Future.successful(Empty)
    else firstValidShortLivedToken(TokenHeaders.allTokenValues(request))

  private def firstValidShortLivedToken(tokenValues: List[String]): Future[Box[ShortLivedToken]] =
    tokenValues match {
      case Nil          => Future.successful(Empty)
      case head :: tail =>
        shortLivedTokenService.findValid(head).futureBox.flatMap {
          case Empty => firstValidShortLivedToken(tail)
          case other => Future.successful(other)
        }
    }

  private def requiredScopeFor(request: RequestHeader): Option[Scope] =
    request.attrs.get(Router.Attrs.HandlerDef).flatMap { handlerDef =>
      RouteScopes.requiredScope(handlerDef.controller, handlerDef.method, request.method)
    }

  private def deny(
      request: RequestHeader,
      effectiveScopes: Scope.Set,
      reason: String,
      nextFilter: RequestHeader => Future[Result]
  ): Future[Result] =
    if (conf.WebKnossos.TokenScopes.enforced) {
      logger.info(s"Denying ${request.method} ${request.path} for scoped token: $reason")
      Future.successful(
        Forbidden(Json.obj("messages" -> Json.arr(Json.obj("error" -> s"Not allowed for this token. $reason"))))
      )
    } else {
      // Permissive mode, for finding routes that still need to be classified before turning enforcement on.
      logger.warn(
        s"Would deny ${request.method} ${request.path} for scoped token (scopes $effectiveScopes): $reason. " +
          "Allowing it because webKnossos.tokenScopes.enforced is false."
      )
      nextFilter(request)
    }
}
