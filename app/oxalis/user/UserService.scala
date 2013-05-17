package oxalis.user

import play.api.{ Logger, Application }
import scala.Some
import scala.concurrent.Await
import scala.concurrent.duration._
import models.user.User

/**
 * A Sample In Memory user service in Scala
 *
 * IMPORTANT: This is just a sample and not suitable for a production environment since
 * it stores everything in memory.
 */
object UserService {
  def findOneById(id: String): Option[User] = {
    UserCache.findUser(id)
  }
}