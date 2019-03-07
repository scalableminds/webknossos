package com.scalableminds.webknossos.tracingstore

import com.redis._
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class RedisTemporaryStore @Inject()(config: TracingStoreConfig) extends LazyLogging {
  private val address = config.Tracingstore.Redis.address
  private val port = config.Tracingstore.Redis.port
  private lazy val r = new RedisClient(address, port)

  def find(id: String): Option[String] =
    r.synchronized {
      r.get(id)
    }

  def removeAllConditional(pattern: String): Seq[Long] =
    r.synchronized {
      val keysOpt: Option[List[Option[String]]] = r.keys(pattern)
      keysOpt.map { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(r.del(_))
        }
      }.getOrElse(Seq())
    }

  def findAllConditional(pattern: String): Seq[String] =
    r.synchronized {
      val keysOpt: Option[List[Option[String]]] = r.keys(pattern)
      keysOpt.map { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(r.get(_))
        }
      }.getOrElse(Seq())
    }

  def keys(pattern: String): List[String] =
    r.synchronized {
      r.keys(pattern).map(_.flatten).getOrElse(List())
    }

  def insert(id: String, value: String, expirationOpt: Option[FiniteDuration] = None): Boolean =
    r.synchronized {
      expirationOpt
        .map(
          expiration => r.setex(id, expiration.toSeconds, value)
        )
        .getOrElse(
          r.set(id, value)
        )
    }

  def contains(id: String): Boolean =
    r.synchronized {
      r.exists(id)
    }

  def remove(id: String): Option[Long] =
    r.synchronized {
      r.del(id)
    }

  def checkHealth(implicit ec: ExecutionContext): Fox[Unit] = {
    val reply = r.ping
    if (reply.contains("PONG")) {
      logger.info(s"Successfully tested Redis health at $address:$port. Reply: $reply}")
      Fox.successful(())
    } else {
      logger.error(s"Redis health check failed at $address:$port (reply: $reply)")
      Fox.failure(s"Redis health check failed")
    }
  }

}
