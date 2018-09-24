package oxalis.user

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import models.user.{User, UserDAO}
import play.api.cache._
import utils.{ObjectId, WkConf}

class UserCache @Inject()(userDAO: UserDAO, conf: WkConf, cache: SyncCacheApi) {
  def cacheKeyForUser(id: ObjectId) =
    s"user.${id.toString}"

  def findUser(id: ObjectId) = {
    cache.getOrElseUpdate(cacheKeyForUser(id), conf.User.cacheTimeoutInMinutes) {
      userDAO.findOne(id)(GlobalAccessContext)
    }
  }

  def store(id: ObjectId, user: Fox[User]) = {
    cache.set(cacheKeyForUser(id), user)
    user
  }

  def invalidateUser(id: ObjectId) =
    cache.remove(cacheKeyForUser(id))
}
