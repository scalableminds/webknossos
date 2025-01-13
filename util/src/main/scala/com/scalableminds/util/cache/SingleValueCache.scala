package com.scalableminds.util.cache

import scala.concurrent.duration._
import java.time.Instant

class SingleValueCache[T](expirationTime: Duration) {

  private var cache: Option[(Instant, T)] = None

  // Method to get cached result or compute a new one
  def cachedMethod(computation: => T): T = {
    val now = Instant.now()
    cache match {
      case Some((expiration, value)) if now.isBefore(expiration) =>
        value // Return cached value if valid
      case _ =>
        val result = computation // Compute new result
        cache = Some(now.plusMillis(expirationTime.toMillis), result) // Update cache
        result
    }
  }
}
