package backend

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import org.scalatest.wordspec.AnyWordSpec
import security.TokenType.TokenType
import security.{ShortLivedToken, ShortLivedTokenService, Token, TokenDAO, TokenType}

import scala.collection.mutable
import scala.concurrent.duration.DurationInt
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

  override def deleteAllByUserIdAndType(userId: ObjectId, tokenType: TokenType): Fox[Unit] = {
    tokens.filterInPlace { case (_, t) => !(t._user == userId && t.tokenType == tokenType) }
    Fox.successful(())
  }
}

class ShortLivedTokenTestSuite extends AnyWordSpec {

  private given ExecutionContext = ExecutionContext.global

  private def await[T](fox: Fox[T]) = Await.result(fox.futureBox, 5.seconds)

  private def setup(): (InMemoryTokenDAO, ShortLivedTokenService) = {
    val dao = new InMemoryTokenDAO
    (dao, new ShortLivedTokenService(dao))
  }

  private def create(
      service: ShortLivedTokenService,
      userId: ObjectId,
      expiry: scala.concurrent.duration.FiniteDuration
  ) =
    await(service.create(userId, expiry)).get("creating a token must succeed in this test")

  private def findValid(service: ShortLivedTokenService, value: String): Option[ShortLivedToken] =
    await(service.findValid(value)).toOption

  "ShortLivedTokenService" should {
    "store a created token as a short-lived token without idle timeout" in {
      val (dao, service) = setup()
      val userId = ObjectId.generate
      val token = create(service, userId, 1.hour)
      val stored = dao.tokens(token.value)
      assert(stored.tokenType == TokenType.ShortLived)
      assert(stored._user == userId)
      assert(stored.idleTimeout.isEmpty)
      assert(stored.expirationDateTime == token.expiresAt)
      assert(token.value.startsWith("wkst_"))
      assert(service.isShortLivedTokenValue(token.value))
    }

    "find a token it created" in {
      val (_, service) = setup()
      val userId = ObjectId.generate
      val token = create(service, userId, 1.hour)
      assert(findValid(service, token.value).map(_.userId).contains(userId))
    }

    "create distinct tokens" in {
      val (_, service) = setup()
      val userId = ObjectId.generate
      assert(create(service, userId, 1.hour).value != create(service, userId, 1.hour).value)
    }

    "not find an unknown token" in {
      val (_, service) = setup()
      assert(findValid(service, "wkst_unknown").isEmpty)
    }

    "not query the database for values without the prefix" in {
      val (dao, service) = setup()
      assert(findValid(service, "someRegularApiToken").isEmpty)
      assert(dao.findCalls == 0)
    }

    "not accept a token of another type, even with the prefix" in {
      val (dao, service) = setup()
      val now = Instant.now
      val value = "wkst_notShortLived"
      dao.tokens.put(
        value,
        Token(ObjectId.generate, value, ObjectId.generate, now, now + 1.hour, None, TokenType.Authentication, now)
      )
      assert(findValid(service, value).isEmpty)
    }

    "not find an expired token" in {
      val (_, service) = setup()
      val token = create(service, ObjectId.generate, -1.second)
      assert(findValid(service, token.value).isEmpty)
    }

    "revoke all tokens of one user, but not those of others" in {
      val (_, service) = setup()
      val userId = ObjectId.generate
      val otherUserId = ObjectId.generate
      val tokenA = create(service, userId, 1.hour)
      val tokenB = create(service, userId, 1.hour)
      val tokenOfOther = create(service, otherUserId, 1.hour)

      await(service.revokeAllForUser(userId))

      assert(findValid(service, tokenA.value).isEmpty)
      assert(findValid(service, tokenB.value).isEmpty)
      assert(findValid(service, tokenOfOther.value).isDefined)
    }

    "revoke the tokens of several users at once" in {
      val (_, service) = setup()
      val userA = ObjectId.generate
      val userB = ObjectId.generate
      val userC = ObjectId.generate
      val tokenA = create(service, userA, 1.hour)
      val tokenB = create(service, userB, 1.hour)
      val tokenC = create(service, userC, 1.hour)

      await(service.revokeAllForUsers(Seq(userA, userB)))

      assert(findValid(service, tokenA.value).isEmpty)
      assert(findValid(service, tokenB.value).isEmpty)
      assert(findValid(service, tokenC.value).isDefined)
    }
  }
}
