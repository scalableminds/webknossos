package backend

import com.scalableminds.util.objectid.ObjectId
import org.scalatest.wordspec.AnyWordSpec
import security.ShortLivedTokenService

import scala.concurrent.duration.DurationInt

class ShortLivedTokenTestSuite extends AnyWordSpec {

  "ShortLivedTokenService" should {
    "find a token it created" in {
      val service = new ShortLivedTokenService
      val userId = ObjectId.generate
      val token = service.create(userId, 1 hour)
      assert(service.findValid(token.value).map(_.userId).contains(userId))
    }

    "not find an unknown token" in {
      val service = new ShortLivedTokenService
      assert(service.findValid("unknown").isEmpty)
    }

    "create distinct tokens" in {
      val service = new ShortLivedTokenService
      val userId = ObjectId.generate
      assert(service.create(userId, 1 hour).value != service.create(userId, 1 hour).value)
    }

    "not find an expired token" in {
      val service = new ShortLivedTokenService
      val token = service.create(ObjectId.generate, -1 second)
      assert(service.findValid(token.value).isEmpty)
      assert(service.get(token.value).isEmpty) // expired tokens are dropped from the cache
    }

    "revoke all tokens of one user, but not those of others" in {
      val service = new ShortLivedTokenService
      val userId = ObjectId.generate
      val otherUserId = ObjectId.generate
      val tokenA = service.create(userId, 1 hour)
      val tokenB = service.create(userId, 1 hour)
      val tokenOfOther = service.create(otherUserId, 1 hour)

      service.revokeAllForUser(userId)

      assert(service.findValid(tokenA.value).isEmpty)
      assert(service.findValid(tokenB.value).isEmpty)
      assert(service.findValid(tokenOfOther.value).isDefined)
    }
  }
}
