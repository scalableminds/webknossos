package security

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class ShortLivedToken(value: String, userId: ObjectId, expiresAt: Instant)

/** Short-lived tokens are handed out to external tools (e.g. the WEBKNOSSOS Python library, driven by an AI agent via
  * the MCP server). They act for the user they were created for, expire after a short time, and are limited to the
  * permissions that user currently grants to agents (User.mcpAgentScopes). Those are checked on every request rather
  * than frozen into the token, see filters.ScopeFilter.
  *
  * They are stored in webknossos.tokens with TokenType.ShortLived, so the regular token authentication accepts them
  * like any other token. They have no idle timeout, so silhouette never writes lastUsedDateTime back for them. Expired
  * ones are cleaned up together with all other tokens (see TokenDAO.deleteAllExpired).
  *
  * Their values carry a fixed prefix. This lets findValid skip the database for all other tokens, so checking whether a
  * request uses a scoped token does not cost an extra database roundtrip for regular API tokens.
  */
class ShortLivedTokenService @Inject() (tokenDAO: TokenDAO)(implicit ec: ExecutionContext) {

  private val valuePrefix = "wkst_"

  def create(userId: ObjectId, expiry: FiniteDuration): Fox[ShortLivedToken] = {
    val now = Instant.now
    val token = Token(
      _id = ObjectId.generate,
      value = valuePrefix + RandomIDGenerator.generateBlocking(),
      _user = userId,
      lastUsedDateTime = now,
      expirationDateTime = now + expiry,
      idleTimeout = None,
      tokenType = TokenType.ShortLived,
      created = now
    )
    for {
      _ <- tokenDAO.insertOne(token)
    } yield ShortLivedToken(token.value, token._user, token.expirationDateTime)
  }

  def isShortLivedTokenValue(value: String): Boolean = value.startsWith(valuePrefix)

  // Empty if the token does not exist, is not a short-lived token, has been revoked or has expired.
  def findValid(value: String): Fox[ShortLivedToken] =
    if (!isShortLivedTokenValue(value)) Fox.empty
    else
      for {
        token <- tokenDAO.findOneByValue(value)
        _ <- Fox.fromBool(token.tokenType == TokenType.ShortLived)
        _ <- Fox.fromBool(token.expirationDateTime > Instant.now)
      } yield ShortLivedToken(token.value, token._user, token.expirationDateTime)

  def revokeAllForUser(userId: ObjectId): Fox[Unit] =
    tokenDAO.deleteAllByUserIdAndType(userId, TokenType.ShortLived)

  def revokeAllForUsers(userIds: Seq[ObjectId]): Fox[Unit] =
    Fox.serialCombined(userIds)(revokeAllForUser).map(_ => ())
}
