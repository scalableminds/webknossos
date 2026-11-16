package security

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import oauth.{OAuthGrant, OAuthGrantDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class ScopedApiToken(value: String, userId: ObjectId, expiresAt: Instant, grantId: ObjectId, scopes: Scope.Set)

/** Scoped API tokens are API tokens for clients that a user connected via OAuth. Today those are AI agents, which get
  * them from the MCP server for use with the WEBKNOSSOS Python library. Each one is issued under an OAuth grant (see
  * oauth.OAuthService): it acts for the grant's user, is limited to the grant's scopes and is revoked together with the
  * grant. The scopes are read from the grant on every request rather than frozen into the token, so changing them takes
  * effect immediately, see filters.ScopeFilter.
  *
  * They are stored in webknossos.tokens with TokenType.ScopedApi, so the regular token authentication accepts them like
  * any other token. They have no idle timeout, so silhouette never writes lastUsedDateTime back for them. Expired ones
  * are cleaned up together with all other tokens (see TokenDAO.deleteAllExpired).
  *
  * Their values carry a fixed prefix. This lets findValid skip the database for all other tokens, so checking whether a
  * request uses a scoped token does not cost an extra database roundtrip for regular API tokens.
  */
class ScopedApiTokenService @Inject() (tokenDAO: TokenDAO, grantDAO: OAuthGrantDAO)(implicit ec: ExecutionContext) {

  private val valuePrefix = "wk_scoped_api_token_"

  def create(grant: OAuthGrant, expiry: FiniteDuration): Fox[ScopedApiToken] =
    insert(grant._user, grant._id, Scope.Set.parse(grant.scopes), Instant.now + expiry)

  /** Another token under the same grant, e.g. when an agent asks for a datastore token. It expires no later than the
    * existing one. Otherwise a scoped API token could renew itself forever, without the OAuth tokens of its grant.
    */
  def createFrom(existing: ScopedApiToken, expiry: FiniteDuration): Fox[ScopedApiToken] = {
    val requestedExpiresAt = Instant.now + expiry
    val expiresAt = if (existing.expiresAt < requestedExpiresAt) existing.expiresAt else requestedExpiresAt
    insert(existing.userId, existing.grantId, existing.scopes, expiresAt)
  }

  private def insert(
      userId: ObjectId,
      grantId: ObjectId,
      scopes: Scope.Set,
      expiresAt: Instant
  ): Fox[ScopedApiToken] = {
    val now = Instant.now
    val token = Token(
      _id = ObjectId.generate,
      value = valuePrefix + RandomIDGenerator.generateBlocking(),
      _user = userId,
      lastUsedDateTime = now,
      expirationDateTime = expiresAt,
      idleTimeout = None,
      tokenType = TokenType.ScopedApi,
      created = now,
      _oauthGrant = Some(grantId)
    )
    for {
      _ <- tokenDAO.insertOne(token)
    } yield ScopedApiToken(token.value, userId, token.expirationDateTime, grantId, scopes)
  }

  def isScopedApiTokenValue(value: String): Boolean = value.startsWith(valuePrefix)

  /** Empty if the token does not exist, is not a scoped API token, has been revoked or has expired, or if its grant has
    * been revoked. Failure means that the lookup itself failed, callers must then fail closed.
    */
  def findValid(value: String): Fox[ScopedApiToken] =
    if (!isScopedApiTokenValue(value)) Fox.empty
    else
      for {
        token <- tokenDAO.findOneByValue(value)
        _ <- Fox.fromBool(token.tokenType == TokenType.ScopedApi)
        _ <- Fox.fromBool(token.expirationDateTime > Instant.now)
        grantId <- token._oauthGrant.toFox
        // Not found (empty) if the grant has been revoked.
        grant <- grantDAO.findLive(grantId)
      } yield ScopedApiToken(
        token.value,
        token._user,
        token.expirationDateTime,
        grant._id,
        Scope.Set.parse(grant.scopes)
      )

  def revokeAllForGrant(grantId: ObjectId): Fox[Unit] =
    tokenDAO.deleteAllByOAuthGrant(grantId)
}
