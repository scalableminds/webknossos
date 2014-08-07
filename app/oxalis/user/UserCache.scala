package oxalis.user

import play.api.cache.Cache
import play.api.Play.current
import scala.concurrent.Future
import models.user.{UserDAO, User}
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.Fox

object UserCache {
  val userCacheTimeout = current.configuration.getInt("user.cacheTimeout") getOrElse 3
  val userCacheKeyPrefix = current.configuration.getString("user.cacheKey") getOrElse "user"

  def cacheKeyForUser(id: String) =
    s"${userCacheKeyPrefix}.${id}"

  def findUser(id: String) = {
    Cache.getOrElse(cacheKeyForUser(id), userCacheTimeout) {
      UserDAO.findOneById(id)(GlobalAccessContext)
    }
  }

  def store(id: String, user: Fox[User]) = {
    Cache.set(cacheKeyForUser(id), user)
    user
  }

  def invalidateUser(id: String) =
    Cache.remove(cacheKeyForUser(id))
}
