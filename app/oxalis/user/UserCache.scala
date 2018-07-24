package oxalis.user

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.user.{UserSQL, UserSQLDAO}
import play.api.Play.current
import play.api.cache.Cache
import utils.ObjectId

object UserCache {
  val userCacheTimeout = current.configuration.getInt("user.cacheTimeout") getOrElse 3
  val userCacheKeyPrefix = current.configuration.getString("user.cacheKey") getOrElse "user"

  def cacheKeyForUser(id: ObjectId) =
    s"${userCacheKeyPrefix}.${id.toString}"

  def findUser(id: ObjectId) = {
    Cache.getOrElse(cacheKeyForUser(id), userCacheTimeout) {
      UserSQLDAO.findOne(id)(GlobalAccessContext)
    }
  }

  def store(id: ObjectId, user: Fox[UserSQL]) = {
    Cache.set(cacheKeyForUser(id), user)
    user
  }

  def invalidateUser(id: ObjectId) =
    Cache.remove(cacheKeyForUser(id))
}
