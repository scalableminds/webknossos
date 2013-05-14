package models.services

import play.api.cache.Cache
import play.api.Play.current
import scala.concurrent.Future
import models.user.User

object UserCache {
  val userCacheTimeout = current.configuration.getInt("user.cacheTimeout") getOrElse 60
  val userCacheKeyPrefix = current.configuration.getString("user.cacheKey") getOrElse "user"

  def cacheKeyForUser(id: String) =
    s"${userCacheKeyPrefix}.${id}"

  def findUser(id: String) = {
    Cache.getOrElse(cacheKeyForUser(id), userCacheTimeout) {
      User.findOneById(id)
    }
  }
  
  def invalidateUser(id: String) = 
    Cache.remove(cacheKeyForUser(id))
}