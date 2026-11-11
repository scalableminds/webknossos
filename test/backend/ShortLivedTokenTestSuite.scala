package backend

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import oauth.{OAuthGrant, OAuthGrantDAO}
import org.scalatest.wordspec.AnyWordSpec
import security.{Scope, ScopeMode, ScopeResource, ShortLivedToken, ShortLivedTokenService, Token, TokenDAO, TokenType}

import scala.collection.mutable
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{Await, ExecutionContext}

/** Keeps the tokens in memory and mimics the soft deletion of the real DAO. The SqlClient is never touched, because all
  * methods ShortLivedTokenService uses are overridden. The round trip through the real database is covered by the e2e
  * tests in mcp.e2e.ts.
  */
class InMemoryTokenDAO(implicit ec: ExecutionContext) extends TokenDAO(null) {
  val tokens: mutable.Map[String, Token] = mutable.Map.empty
  var findCalls: Int = 0

  override def insertOne(t: Token): Fox[Unit] = {
    tokens.put(t.value, t)
    Fox.successful(())
  }

  override def findOneByValue(value: String): Fox[Token] = {
    findCalls += 1
    tokens.get(value).filterNot(_.isDeleted).toFox
  }

  override def deleteAllByOAuthGrant(grantId: ObjectId): Fox[Unit] = {
    tokens.filterInPlace { case (_, t) => !t._oauthGrant.contains(grantId) }
    Fox.successful(())
  }
}

class InMemoryOAuthGrantDAO(implicit ec: ExecutionContext) extends OAuthGrantDAO(null) {
  val grants: mutable.Map[ObjectId, OAuthGrant] = mutable.Map.empty

  override def findLive(id: ObjectId): Fox[OAuthGrant] = grants.get(id).filterNot(_.isDeleted).toFox
}

class ShortLivedTokenTestSuite extends AnyWordSpec {

  private given ExecutionContext = ExecutionContext.global

  private def await[T](fox: Fox[T]) = Await.result(fox.futureBox, 5.seconds)

  private case class Setup(
      tokenDAO: InMemoryTokenDAO,
      grantDAO: InMemoryOAuthGrantDAO,
      service: ShortLivedTokenService
  ) {
    def addGrant(scopes: String = "write", userId: ObjectId = ObjectId.generate): OAuthGrant = {
      val grant = OAuthGrant(ObjectId.generate, userId, "https://client.example.com/metadata.json", "Client", scopes)
      grantDAO.grants.put(grant._id, grant)
      grant
    }

    def create(grant: OAuthGrant, expiry: FiniteDuration = 1.hour): ShortLivedToken =
      await(service.create(grant, expiry)).get("creating a token must succeed in this test")

    def findValid(value: String): Option[ShortLivedToken] = await(service.findValid(value)).toOption
  }

  private def setup(): Setup = {
    val tokenDAO = new InMemoryTokenDAO
    val grantDAO = new InMemoryOAuthGrantDAO
    Setup(tokenDAO, grantDAO, new ShortLivedTokenService(tokenDAO, grantDAO))
  }

  "ShortLivedTokenService" should {
    "store a created token as a short-lived token of the grant's user, without idle timeout" in {
      val s = setup()
      val grant = s.addGrant()
      val token = s.create(grant)
      val stored = s.tokenDAO.tokens(token.value)
      assert(stored.tokenType == TokenType.ShortLived)
      assert(stored._user == grant._user)
      assert(stored._oauthGrant.contains(grant._id))
      assert(stored.idleTimeout.isEmpty)
      assert(stored.expirationDateTime == token.expiresAt)
      assert(token.value.startsWith("wkst_"))
      assert(s.service.isShortLivedTokenValue(token.value))
    }

    "find a token it created, with the grant's scopes" in {
      val s = setup()
      val grant = s.addGrant(scopes = "read")
      val token = s.create(grant)
      val found = s.findValid(token.value)
      assert(found.map(_.userId).contains(grant._user))
      assert(found.map(_.grantId).contains(grant._id))
      assert(found.exists(_.scopes.allows(Scope(ScopeResource.dataset, ScopeMode.read))))
      assert(!found.exists(_.scopes.allows(Scope(ScopeResource.dataset, ScopeMode.write))))
    }

    "follow the current scopes of the grant" in {
      val s = setup()
      val grant = s.addGrant(scopes = "read")
      val token = s.create(grant)
      s.grantDAO.grants.put(grant._id, grant.copy(scopes = "delete"))
      assert(s.findValid(token.value).exists(_.scopes.allows(Scope(ScopeResource.annotation, ScopeMode.delete))))
    }

    "create another token under the same grant" in {
      val s = setup()
      val grant = s.addGrant()
      val token = s.create(grant)
      val derived = await(s.service.createFrom(token, 1.hour)).get("creating a token must succeed in this test")
      assert(derived.value != token.value)
      assert(s.findValid(derived.value).map(_.grantId).contains(grant._id))
    }

    "create distinct tokens" in {
      val s = setup()
      val grant = s.addGrant()
      assert(s.create(grant).value != s.create(grant).value)
    }

    "not find an unknown token" in {
      val s = setup()
      assert(s.findValid("wkst_unknown").isEmpty)
    }

    "not query the database for values without the prefix" in {
      val s = setup()
      assert(s.findValid("someRegularApiToken").isEmpty)
      assert(s.tokenDAO.findCalls == 0)
    }

    "not accept a token of another type, even with the prefix" in {
      val s = setup()
      val now = Instant.now
      val value = "wkst_notShortLived"
      s.tokenDAO.tokens.put(
        value,
        Token(ObjectId.generate, value, ObjectId.generate, now, now + 1.hour, None, TokenType.Authentication, now)
      )
      assert(s.findValid(value).isEmpty)
    }

    "not accept a short-lived token without a grant" in {
      val s = setup()
      val now = Instant.now
      val value = "wkst_withoutGrant"
      s.tokenDAO.tokens.put(
        value,
        Token(ObjectId.generate, value, ObjectId.generate, now, now + 1.hour, None, TokenType.ShortLived, now)
      )
      assert(s.findValid(value).isEmpty)
    }

    "not find an expired token" in {
      val s = setup()
      val token = s.create(s.addGrant(), (-1).second)
      assert(s.findValid(token.value).isEmpty)
    }

    "not find a token whose grant has been revoked" in {
      val s = setup()
      val grant = s.addGrant()
      val token = s.create(grant)
      s.grantDAO.grants.put(grant._id, grant.copy(isDeleted = true))
      assert(s.findValid(token.value).isEmpty)
    }

    "revoke all tokens of one grant, but not those of others" in {
      val s = setup()
      val grant = s.addGrant()
      val otherGrant = s.addGrant(userId = grant._user)
      val tokenA = s.create(grant)
      val tokenB = s.create(grant)
      val tokenOfOther = s.create(otherGrant)

      await(s.service.revokeAllForGrant(grant._id))

      assert(s.findValid(tokenA.value).isEmpty)
      assert(s.findValid(tokenB.value).isEmpty)
      assert(s.findValid(tokenOfOther.value).isDefined)
    }
  }
}
