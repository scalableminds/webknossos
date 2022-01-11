package com.scalableminds.webknossos.datastore.storage

import com.redis._
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

trait RedisTemporaryStore extends LazyLogging {
  implicit def ec: ExecutionContext
  protected def address: String
  protected def port: Int
  private lazy val r = new RedisClient(address, port)

  def find(id: String): Fox[Option[String]] =
    withExceptionHandler {
      r.get(id)
    }

  def removeAllConditional(pattern: String): Fox[Unit] =
    withExceptionHandler {
      val keysOpt: Option[List[Option[String]]] = r.keys(pattern)
      keysOpt.foreach { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(r.del(_))
        }
      }
    }

  def findAllConditional(pattern: String): Fox[Seq[String]] =
    withExceptionHandler {
      val keysOpt: Option[List[Option[String]]] = r.keys(pattern)
      keysOpt.map { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(r.get(_))
        }
      }.getOrElse(Seq())
    }

  def keys(pattern: String): Fox[List[String]] =
    withExceptionHandler {
      r.keys(pattern).map(_.flatten).getOrElse(List())
    }

  def insert(id: String, value: String, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    withExceptionHandler {
      expirationOpt
        .map(
          expiration => r.setex(id, expiration.toSeconds, value)
        )
        .getOrElse(
          r.set(id, value)
        )
    }

  def contains(id: String): Fox[Boolean] =
    withExceptionHandler {
      r.exists(id)
    }

  def remove(id: String): Fox[Boolean] =
    withExceptionHandler {
      r.del(id).getOrElse(0L) > 0
    }

  def checkHealth(implicit ec: ExecutionContext): Fox[Unit] =
    try {
      val reply = r.ping
      if (!reply.contains("PONG")) throw new Exception(reply.getOrElse("No Reply"))
      logger.info(s"Successfully tested Redis health at $address:$port. Reply: $reply)")
      Fox.successful(())
    } catch {
      case e: Exception =>
        logger.error(s"Redis health check failed at $address:$port (reply: ${e.getMessage})")
        Fox.failure(s"Redis health check failed")
    }

  def withExceptionHandler[B](f: => B): Fox[B] =
    try {
      r.synchronized {
        Fox.successful(f)
      }
    } catch {
      case e: Exception =>
        val msg = "Redis access exception: " + e.getMessage
        logger.error(msg)
        Fox.failure(msg)
    }

  def insertIntoSet(id: String, value: String): Fox[Boolean] =
    withExceptionHandler {
      r.sadd(id, value).getOrElse(0L) > 0
    }

  def removeFromSet(id: String, value: String): Fox[Boolean] =
    withExceptionHandler {
      r.srem(id, value).getOrElse(0L) > 0
    }

  def findSet(id: String): Fox[Set[String]] =
    withExceptionHandler {
      r.smembers(id).map(_.flatten).getOrElse(Set.empty)
    }

}
