package security

import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant

import javax.inject.Singleton
import scala.concurrent.duration.FiniteDuration

case class ShortLivedToken(value: String, userId: ObjectId, expiresAt: Instant) {
  def isValid: Boolean = expiresAt > Instant.now
}

/**
  * Short-lived tokens are handed out to external tools (e.g. the WEBKNOSSOS Python library, driven by an AI agent via
  * the MCP server). They grant the full permissions of the user they were created for, but expire after a short time.
  *
  * In contrast to the other token types, these are not persisted in the database, but held in memory only. They
  * therefore do not survive a backend restart, and in a multi-instance deployment they are only valid on the instance
  * that issued them. Compare RpcTokenHolder.webknossosToken, which is process-local as well.
  */
@Singleton
class ShortLivedTokenService extends LRUConcurrentCache[String, ShortLivedToken] {

  override def maxEntries: Int = 10000

  def create(userId: ObjectId, expiry: FiniteDuration): ShortLivedToken = {
    val token = ShortLivedToken(
      value = RandomIDGenerator.generateBlocking(),
      userId = userId,
      expiresAt = Instant.in(expiry)
    )
    put(token.value, token)
    token
  }

  def findValid(value: String): Option[ShortLivedToken] =
    get(value).flatMap { token =>
      if (token.isValid) Some(token)
      else {
        remove(value)
        None
      }
    }

  def revokeAllForUser(userId: ObjectId): Unit =
    val _ = clear(value => get(value).exists(_.userId == userId))
}
