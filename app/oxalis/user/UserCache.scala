package oxalis.user

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.user.{User, UserDAO}
import play.api.Play.current
import play.api.cache.Cache
import utils.{ObjectId, WkConf}

object UserCache {
  def cacheKeyForUser(id: ObjectId) =
    s"user.${id.toString}"

  def findUser(id: ObjectId) = {
    Cache.getOrElse(cacheKeyForUser(id), WkConf.User.cacheTimeoutInMinutes) {
      UserDAO.findOne(id)(GlobalAccessContext)
    }
  }

  def store(id: ObjectId, user: Fox[User]) = {
    Cache.set(cacheKeyForUser(id), user)
    user
  }

  def invalidateUser(id: ObjectId) =
    Cache.remove(cacheKeyForUser(id))
}
