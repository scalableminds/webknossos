package backend

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import oauth.{OAuthGrant, OAuthGrantDAO}
import org.scalatest.wordspec.AsyncWordSpec
import security.{Scope, ScopeMode, ScopeResource, ScopedApiToken, ScopedApiTokenService, Token, TokenDAO, TokenType}

import scala.collection.mutable
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}

/** Keeps the tokens in memory and mimics the soft deletion of the real DAO. The SqlClient is never touched, because all
  * methods ScopedApiTokenService uses are overridden. The round trip through the real database is covered by the e2e
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

class ScopedApiTokenTestSuite extends AsyncWordSpec {

  private case class Setup(
      tokenDAO: InMemoryTokenDAO,
      grantDAO: InMemoryOAuthGrantDAO,
      service: ScopedApiTokenService
  ) {
    def addGrant(scopes: String = "write", userId: ObjectId = ObjectId.generate): OAuthGrant = {
      val grant = OAuthGrant(ObjectId.generate, userId, "https://client.example.com/metadata.json", "Client", scopes)
      grantDAO.grants.put(grant._id, grant)
      grant
    }

    def create(grant: OAuthGrant, expiry: FiniteDuration = 1.hour): Future[ScopedApiToken] =
      service.create(grant, expiry).toFutureOrThrowException("creating a token must succeed in this test")

    def createFrom(token: ScopedApiToken, expiry: FiniteDuration): Future[ScopedApiToken] =
      service.createFrom(token, expiry).toFutureOrThrowException("creating a token must succeed in this test")

    def findValid(value: String): Future[Option[ScopedApiToken]] = service.findValid(value).toFutureOption
  }

  private def setup(): Setup = {
    val tokenDAO = new InMemoryTokenDAO
    val grantDAO = new InMemoryOAuthGrantDAO
    Setup(tokenDAO, grantDAO, new ScopedApiTokenService(tokenDAO, grantDAO))
  }

  "ScopedApiTokenService" should {
    "store a created token as a scoped API token of the grant's user, without idle timeout" in {
      val s = setup()
      val grant = s.addGrant()
      s.create(grant).map { token =>
        val stored = s.tokenDAO.tokens(token.value)
        assert(stored.tokenType == TokenType.ScopedApi)
        assert(stored._user == grant._user)
        assert(stored._oauthGrant.contains(grant._id))
        assert(stored.idleTimeout.isEmpty)
        assert(stored.expirationDateTime == token.expiresAt)
        assert(token.value.startsWith("wk_scoped_api_token_"))
        assert(s.service.looksLikeScopedApiTokenValue(token.value))
      }
    }

    "find a token it created, with the grant's scopes" in {
      val s = setup()
      val grant = s.addGrant(scopes = "read")
      for {
        token <- s.create(grant)
        found <- s.findValid(token.value)
      } yield {
        assert(found.map(_.userId).contains(grant._user))
        assert(found.map(_.grantId).contains(grant._id))
        assert(found.exists(_.scopes.allows(Scope(ScopeResource.dataset, ScopeMode.read))))
        assert(!found.exists(_.scopes.allows(Scope(ScopeResource.dataset, ScopeMode.write))))
      }
    }

    "follow the current scopes of the grant" in {
      val s = setup()
      val grant = s.addGrant(scopes = "read")
      for {
        token <- s.create(grant)
        _ = s.grantDAO.grants.put(grant._id, grant.copy(scopes = "delete"))
        found <- s.findValid(token.value)
      } yield assert(found.exists(_.scopes.allows(Scope(ScopeResource.annotation, ScopeMode.delete))))
    }

    "create another token under the same grant" in {
      val s = setup()
      val grant = s.addGrant()
      for {
        token <- s.create(grant)
        derived <- s.createFrom(token, 1.hour)
        found <- s.findValid(derived.value)
      } yield {
        assert(derived.value != token.value)
        assert(found.map(_.grantId).contains(grant._id))
      }
    }

    "not let a derived token outlive the token it was created from" in {
      val s = setup()
      for {
        token <- s.create(s.addGrant(), 1.hour)
        derived <- s.createFrom(token, 1.day)
        shorter <- s.createFrom(token, 1.minute)
      } yield {
        assert(derived.expiresAt == token.expiresAt)
        assert(shorter.expiresAt < token.expiresAt)
      }
    }

    "create distinct tokens" in {
      val s = setup()
      val grant = s.addGrant()
      for {
        tokenA <- s.create(grant)
        tokenB <- s.create(grant)
      } yield assert(tokenA.value != tokenB.value)
    }

    "not find an unknown token" in {
      val s = setup()
      s.findValid("wk_scoped_api_token_unknown").map(found => assert(found.isEmpty))
    }

    "not query the database for values without the prefix" in {
      val s = setup()
      s.findValid("someRegularApiToken").map { found =>
        assert(found.isEmpty)
        assert(s.tokenDAO.findCalls == 0)
      }
    }

    "not accept a token of another type, even with the prefix" in {
      val s = setup()
      val now = Instant.now
      val value = "wk_scoped_api_token_notAScopedApiToken"
      s.tokenDAO.tokens.put(
        value,
        Token(ObjectId.generate, value, ObjectId.generate, now, now + 1.hour, None, TokenType.Authentication, now)
      )
      s.findValid(value).map(found => assert(found.isEmpty))
    }

    "not accept a scoped API token without a grant" in {
      val s = setup()
      val now = Instant.now
      val value = "wk_scoped_api_token_withoutGrant"
      s.tokenDAO.tokens.put(
        value,
        Token(ObjectId.generate, value, ObjectId.generate, now, now + 1.hour, None, TokenType.ScopedApi, now)
      )
      s.findValid(value).map(found => assert(found.isEmpty))
    }

    "not find an expired token" in {
      val s = setup()
      for {
        token <- s.create(s.addGrant(), (-1).second)
        found <- s.findValid(token.value)
      } yield assert(found.isEmpty)
    }

    "not find a token whose grant has been revoked" in {
      val s = setup()
      val grant = s.addGrant()
      for {
        token <- s.create(grant)
        _ = s.grantDAO.grants.put(grant._id, grant.copy(isDeleted = true))
        found <- s.findValid(token.value)
      } yield assert(found.isEmpty)
    }

    "revoke all tokens of one grant, but not those of others" in {
      val s = setup()
      val grant = s.addGrant()
      val otherGrant = s.addGrant(userId = grant._user)
      for {
        tokenA <- s.create(grant)
        tokenB <- s.create(grant)
        tokenOfOther <- s.create(otherGrant)
        _ <- s.service.revokeAllForGrant(grant._id).toFutureOrThrowException("revoking must succeed in this test")
        foundA <- s.findValid(tokenA.value)
        foundB <- s.findValid(tokenB.value)
        foundOfOther <- s.findValid(tokenOfOther.value)
      } yield {
        assert(foundA.isEmpty)
        assert(foundB.isEmpty)
        assert(foundOfOther.isDefined)
      }
    }
  }
}
