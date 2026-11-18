package security

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import oauth.{OAuthGrant, OAuthGrantDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}

case class ScopedApiToken(value: String, userId: ObjectId, expiresAt: Instant, grantId: ObjectId, scopes: ScopeSet)

/** Scoped API tokens are API tokens for clients that a user connected via OAuth. Today those are AI agents, which get
  * them from the MCP server for use with the WEBKNOSSOS Python library. Each one is issued under an OAuth grant (see
  * oauth.OAuthService): it acts for the grant's user, is limited to the grant's scopes and is revoked together with the
  * grant. The scopes are read from the grant rather than frozen into the token, so changing them takes effect
  * immediately, see filters.ScopeFilter.
  *
  * They are stored in webknossos.tokens with TokenType.ScopedApi, so the regular token authentication accepts them like
  * any other token. They have no idle timeout, so silhouette never writes lastUsedDateTime back for them. Expired ones
  * are cleaned up together with all other tokens (see TokenDAO.deleteAllExpired).
  *
  * Their values carry a fixed prefix. This lets findValid skip the database for all other tokens, so checking whether a
  * request uses a scoped token does not cost an extra database roundtrip for regular API tokens.
  *
  * findValid caches its answers briefly, as an agent sends many requests in a row and each one is looked up by
  * ScopeFilter (and, for the datastore, by validateUserAccess). Everything that revokes scoped API tokens or changes
  * the scopes of a grant goes through this service and clears the cache, so these changes still take effect
  * immediately. The time to live only bounds how long an answer can be stale if a change ever bypasses this service, or
  * if several WEBKNOSSOS instances share a database.
  */
class ScopedApiTokenService @Inject() (tokenDAO: TokenDAO, grantDAO: OAuthGrantDAO)(implicit ec: ExecutionContext) {

  private val valuePrefix = "wk_scoped_api_token_"

  def create(grant: OAuthGrant, expiry: FiniteDuration): Fox[ScopedApiToken] =
    insert(grant._user, grant._id, ScopeSet.parse(grant.scopes), Instant.now + expiry)

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
      scopes: ScopeSet,
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

  def looksLikeScopedApiTokenValue(value: String): Boolean = value.startsWith(valuePrefix)

  /** Empty if the token does not exist, is not a scoped API token, has been revoked or has expired, or if its grant has
    * been revoked. Failure means that the lookup itself failed, callers must then fail closed.
    */
  def findValid(value: String): Fox[ScopedApiToken] =
    if (!looksLikeScopedApiTokenValue(value)) Fox.empty
    else
      for {
        token <- validTokenCache.getOrLoad(value, lookUpValid)
        // A cached token may have expired since.
        _ <- Fox.fromBool(token.expiresAt > Instant.now)
      } yield token

  // Failures are not cached (see AlfuCache), unknown and invalid values are.
  private lazy val validTokenCache: AlfuCache[String, ScopedApiToken] =
    AlfuCache(maxCapacity = 10000, timeToLive = 30.seconds, timeToIdle = 30.seconds)

  /** To be called after the scopes of a grant changed or scoped API tokens were revoked, once the change is in the
    * database. Clearing the cache also drops lookups still in flight, so none of them can put a stale answer back.
    */
  def clearCache(): Unit = validTokenCache.clear()

  private def lookUpValid(value: String): Fox[ScopedApiToken] =
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
      ScopeSet.parse(grant.scopes)
    )

  def revokeAllForGrant(grantId: ObjectId): Fox[Unit] =
    for {
      _ <- tokenDAO.deleteAllByOAuthGrant(grantId)
      _ = clearCache()
    } yield ()

  def revokeAllForUser(userId: ObjectId): Fox[Unit] =
    for {
      _ <- tokenDAO.deleteAllByUserIdAndType(userId, TokenType.ScopedApi)
      _ = clearCache()
    } yield ()
}
