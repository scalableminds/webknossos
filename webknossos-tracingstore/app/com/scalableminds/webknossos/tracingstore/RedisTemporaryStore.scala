package com.scalableminds.webknossos.tracingstore

import com.redis._
import com.redis.serialization.Parse
import javax.inject.Inject

import scala.concurrent.duration.FiniteDuration

class RedisTemporaryStore[V] @Inject()() {
  val r = new RedisClient("localhost", 6379)

  def find(id: String) =
    r.synchronized {
      r.get(id)
    }

  def removeAllConditional(pattern: String) =
    r.synchronized {
      val keysOpt: Option[List[Option[String]]] = r.keys(pattern)
      keysOpt.map { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(r.del(_))
        }
      }.getOrElse(Seq())
    }

  def findAllConditional(pattern: String) =
    r.synchronized {
      val keysOpt: Option[List[Option[String]]] = r.keys(pattern)
      keysOpt.map { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(r.get(_))
        }
      }.getOrElse(Seq())
    }

  def keys(pattern: String) =
    r.synchronized {
      r.keys(pattern).map(_.flatten).getOrElse(List())
    }

  def insert(id: String, value: String, expirationOpt: Option[FiniteDuration] = None) =
    r.synchronized {
      expirationOpt
        .map(
          expiration => r.setex(id, expiration.toSeconds, value)
        )
        .getOrElse(
          r.set(id, value)
        )
    }

  def remove(id: String) =
    r.synchronized {
      r.del(id)
    }

}
