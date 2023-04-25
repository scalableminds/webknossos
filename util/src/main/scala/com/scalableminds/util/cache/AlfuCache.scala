package com.scalableminds.util.cache

import akka.http.caching.LfuCache
import akka.http.caching.scaladsl.{Cache, CachingSettings}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Failure}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}

object AlfuCache {
  def apply[K, V](maxEntries: Int = 1000,
                  timeToLive: FiniteDuration = 2 hours,
                  timeToIdle: FiniteDuration = 1 hour): Cache[K, V] = {
    val defaultCachingSettings = CachingSettings("")
    val lfuCacheSettings =
      defaultCachingSettings.lfuCacheSettings
        .withInitialCapacity(maxEntries)
        .withMaxCapacity(maxEntries)
        .withTimeToLive(timeToLive)
        .withTimeToIdle(timeToIdle)
    val cachingSettings =
      defaultCachingSettings.withLfuCacheSettings(lfuCacheSettings)
    val lfuCache: Cache[K, V] = LfuCache(cachingSettings)
    lfuCache
  }
}

class AlfuFoxCache[K, V](underlyingAkkaCache: Cache[K, Box[V]]) extends FoxImplicits {
  def getOrLoad(key: K, loadFn: K => Fox[V])(implicit ec: ExecutionContext): Fox[V] =
    for {
      box <- underlyingAkkaCache.getOrLoad(key, key => loadFn(key).futureBox)
      _ = box match {
        case _: Failure => underlyingAkkaCache.remove(key) // Do not cache failures
        case _          => ()
      }
      result <- box.toFox
    } yield result

  def remove(key: K): Unit = underlyingAkkaCache.remove(key)

  def clear(): Unit = underlyingAkkaCache.clear()
}

object AlfuFoxCache {
  def apply[K, V](maxEntries: Int = 1000,
                  timeToLive: FiniteDuration = 2 hours,
                  timeToIdle: FiniteDuration = 1 hour): AlfuFoxCache[K, V] = {
    val alfuCache: Cache[K, Box[V]] = AlfuCache(maxEntries, timeToLive, timeToIdle)
    new AlfuFoxCache(alfuCache)
  }
}
