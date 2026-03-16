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
  lazy val authority: String = f"$address:$port"
  private lazy val r = new RedisClientPool(address, port)

  def find(id: String): Fox[Option[String]] =
    withExceptionHandler(_.get(id))

  def findLong(id: String): Fox[Option[Long]] =
    withExceptionHandler(_.get(id).map(s => s.toLong))

  def removeAllConditional(pattern: String): Fox[Unit] =
    withExceptionHandler { client =>
      val keysOpt: Option[List[Option[String]]] = client.keys(pattern)
      keysOpt.foreach { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(client.del(_))
        }
      }
    }

  def findAllConditional(pattern: String): Fox[Seq[String]] =
    withExceptionHandler { client =>
      val keysOpt: Option[List[Option[String]]] = client.keys(pattern)
      keysOpt.map { keys: Seq[Option[String]] =>
        keys.flatMap { key: Option[String] =>
          key.flatMap(client.get(_))
        }
      }.getOrElse(Seq())
    }

  def keys(pattern: String): Fox[List[String]] =
    withExceptionHandler(_.keys(pattern).map(_.flatten).getOrElse(List()))

  def insertKey(id: String, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    insert(id, "", expirationOpt)

  def insert(id: String, value: String, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    withExceptionHandler { client =>
      expirationOpt
        .map(expiration => client.setex(id, expiration.toSeconds, value))
        .getOrElse(client.set(id, value))
    }

  def insertLong(id: String, value: Long, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    withExceptionHandler { client =>
      expirationOpt
        .map(expiration => client.setex(id, expiration.toSeconds, value))
        .getOrElse(client.set(id, value))
    }

  def contains(id: String): Fox[Boolean] =
    withExceptionHandler(_.exists(id))

  def remove(id: String): Fox[Unit] =
    withExceptionHandler(_.del(id))

  def checkHealth(implicit ec: ExecutionContext): Fox[Unit] =
    withExceptionHandler { client =>
      val reply = client.ping
      if (!reply.contains("PONG")) throw new Exception(reply.getOrElse("No Reply"))
      ()
    }

  def insertIntoSet(id: String, value: String): Fox[Boolean] =
    withExceptionHandler(_.sadd(id, value).getOrElse(0L) > 0)

  def isContainedInSet(id: String, value: String): Fox[Boolean] =
    withExceptionHandler(_.sismember(id, value))

  def removeFromSet(id: String, value: String): Fox[Boolean] =
    withExceptionHandler(_.srem(id, value).getOrElse(0L) > 0)

  def findSet(id: String): Fox[Set[String]] =
    withExceptionHandler(_.smembers(id).map(_.flatten).getOrElse(Set.empty))

  private def withExceptionHandler[B](f: RedisClient => B): Fox[B] =
    try {
      r.withClient { client =>
        Fox.successful(f(client))
      }
    } catch {
      case e: Exception =>
        val msg = "Redis access exception: " + e.getMessage
        logger.error(msg)
        Fox.failure(msg)
    }

}
