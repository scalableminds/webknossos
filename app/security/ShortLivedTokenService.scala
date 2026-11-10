package security

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import oauth.{OAuthGrant, OAuthGrantDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class ShortLivedToken(value: String, userId: ObjectId, expiresAt: Instant, grantId: ObjectId, scopes: Scope.Set)

/** Short-lived tokens are handed out to AI agents via the MCP server, for use with the WEBKNOSSOS Python library. Each
  * one is issued under an OAuth grant (see oauth.OAuthService): it acts for the grant's user, is limited to the grant's
  * scopes and is revoked together with the grant. The scopes are read from the grant on every request rather than
  * frozen into the token, so changing them takes effect immediately, see filters.ScopeFilter.
  *
  * They are stored in webknossos.tokens with TokenType.ShortLived, so the regular token authentication accepts them
  * like any other token. They have no idle timeout, so silhouette never writes lastUsedDateTime back for them. Expired
  * ones are cleaned up together with all other tokens (see TokenDAO.deleteAllExpired).
  *
  * Their values carry a fixed prefix. This lets findValid skip the database for all other tokens, so checking whether a
  * request uses a scoped token does not cost an extra database roundtrip for regular API tokens.
  */
class ShortLivedTokenService @Inject() (tokenDAO: TokenDAO, grantDAO: OAuthGrantDAO)(implicit ec: ExecutionContext) {

  private val valuePrefix = "wkst_"

  def create(grant: OAuthGrant, expiry: FiniteDuration): Fox[ShortLivedToken] =
    insert(grant._user, grant._id, Scope.Set.parse(grant.scopes), expiry)

  // Another token under the same grant, e.g. when an agent asks for a datastore token.
  def createFrom(existing: ShortLivedToken, expiry: FiniteDuration): Fox[ShortLivedToken] =
    insert(existing.userId, existing.grantId, existing.scopes, expiry)

  private def insert(
      userId: ObjectId,
      grantId: ObjectId,
      scopes: Scope.Set,
      expiry: FiniteDuration
  ): Fox[ShortLivedToken] = {
    val now = Instant.now
    val token = Token(
      _id = ObjectId.generate,
      value = valuePrefix + RandomIDGenerator.generateBlocking(),
      _user = userId,
      lastUsedDateTime = now,
      expirationDateTime = now + expiry,
      idleTimeout = None,
      tokenType = TokenType.ShortLived,
      created = now,
      _oauthGrant = Some(grantId)
    )
    for {
      _ <- tokenDAO.insertOne(token)
    } yield ShortLivedToken(token.value, userId, token.expirationDateTime, grantId, scopes)
  }

  def isShortLivedTokenValue(value: String): Boolean = value.startsWith(valuePrefix)

  /** Empty if the token does not exist, is not a short-lived token, has been revoked or has expired, or if its grant
    * has been revoked. Failure means that the lookup itself failed, callers must then fail closed.
    */
  def findValid(value: String): Fox[ShortLivedToken] =
    if (!isShortLivedTokenValue(value)) Fox.empty
    else
      for {
        token <- tokenDAO.findOneByValue(value)
        _ <- Fox.fromBool(token.tokenType == TokenType.ShortLived)
        _ <- Fox.fromBool(token.expirationDateTime > Instant.now)
        grantId <- token._oauthGrant.toFox
        // Not found (empty) if the grant has been revoked.
        grant <- grantDAO.findLive(grantId)
      } yield ShortLivedToken(
        token.value,
        token._user,
        token.expirationDateTime,
        grant._id,
        Scope.Set.parse(grant.scopes)
      )

  def revokeAllForGrant(grantId: ObjectId): Fox[Unit] =
    tokenDAO.deleteAllByOAuthGrant(grantId)
}
