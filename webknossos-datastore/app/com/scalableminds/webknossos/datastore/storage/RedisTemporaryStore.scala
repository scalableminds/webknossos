package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.typesafe.scalalogging.LazyLogging
import io.lettuce.core.{ClientOptions, RedisURI, SocketOptions, TimeoutOptions, RedisClient as LettuceClient}
import io.lettuce.core.codec.StringCodec
import io.lettuce.core.api.StatefulRedisConnection
import io.lettuce.core.api.async.RedisAsyncCommands
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{Json, Reads, Writes}

import java.time.Duration as JDuration
import java.util.concurrent.TimeUnit
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.*
import scala.jdk.FutureConverters.*

trait RedisTemporaryStore extends LazyLogging {
  implicit def ec: ExecutionContext
  protected def address: String
  protected def port: Int
  protected def lifecycle: ApplicationLifecycle

  private val connectionTimeout: JDuration = JDuration.ofSeconds(1)
  private val commandTimeout: JDuration = JDuration.ofMinutes(1)

  lazy val authority: String = s"$address:$port"

  private lazy val redisUri: RedisURI = RedisURI.Builder.redis(address, port).withTimeout(commandTimeout).build()

  private lazy val redisClient: LettuceClient = {
    val client = LettuceClient.create(redisUri)
    client.setOptions(
      ClientOptions
        .builder()
        .socketOptions(SocketOptions.builder().connectTimeout(connectionTimeout).build())
        .timeoutOptions(TimeoutOptions.builder().fixedTimeout(commandTimeout).build())
        .build()
    )
    client
  }

  private lazy val connection: StatefulRedisConnection[String, String] = {
    val conn = redisClient
      .connectAsync(StringCodec.UTF8, redisUri)
      .toCompletableFuture
      .orTimeout(connectionTimeout.toSeconds, TimeUnit.SECONDS)
      .get()
    lifecycle.addStopHook { () =>
      Future {
        conn.close()
        redisClient.shutdown()
      }(using scala.concurrent.ExecutionContext.global)
    }
    conn
  }

  private lazy val commands: RedisAsyncCommands[String, String] = connection.async()

  // Wraps access to `commands`, which initializes lazily. If Redis is down at first access,
  // the lazy val throws synchronously; catching it here returns Fox.failure and leaves the lazy
  // val un-initialized so the next call retries. Once the initial connection succeeds, Lettuce
  // handles reconnection internally, so transient outages are recovered automatically.
  private def withCommands[B](f: RedisAsyncCommands[String, String] => Fox[B]): Fox[B] =
    try f(commands) ?-> "Redis access failure"
    catch {
      case e: Exception =>
        val msg = s"Redis access exception on $authority: ${e.getMessage}"
        logger.error(msg)
        Fox.failure(msg)
    }

  def find(id: String): Fox[String] =
    withCommands { cmd =>
      Fox.fromFuture(cmd.get(id).asScala).flatMap { v =>
        if (v == null) Fox.empty else Fox.successful(v)
      }
    }

  def findLong(id: String): Fox[Long] =
    withCommands { cmd =>
      Fox.fromFuture(cmd.get(id).asScala).flatMap { v =>
        if (v == null) Fox.empty else tryo(v.toLong).toFox
      }
    }

  def removeAllConditional(pattern: String): Fox[Unit] =
    withCommands { cmd =>
      for {
        keysList <- Fox.fromFuture(cmd.keys(pattern).asScala.map(_.asScala.toSeq))
        _ <- Fox.runIf(keysList.nonEmpty)(Fox.fromFuture(cmd.del(keysList*).asScala))
      } yield ()
    }

  def findAllConditional(pattern: String): Fox[Seq[String]] =
    withCommands { cmd =>
      for {
        keysList <- Fox.fromFuture(cmd.keys(pattern).asScala.map(_.asScala.toSeq))
        values <-
          if (keysList.isEmpty)
            Fox.successful(Seq.empty)
          else
            Fox.fromFuture(
              cmd.mget(keysList*).asScala.map(_.asScala.filter(_.hasValue).map(_.getValue).toSeq)
            )
      } yield values
    }

  def keys(pattern: String): Fox[Seq[String]] =
    withCommands(cmd => Fox.fromFuture(cmd.keys(pattern).asScala.map(_.asScala.toSeq)))

  def insertKey(id: String, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    insert(id, "", expirationOpt)

  def insert(id: String, value: String, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    withCommands { cmd =>
      val stage = expirationOpt match {
        case Some(expiration) => cmd.setex(id, expiration.toSeconds, value)
        case None             => cmd.set(id, value)
      }
      Fox.fromFuture(stage.asScala.map(_ => ()))
    }

  def insertLong(id: String, value: Long, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] =
    insert(id, value.toString, expirationOpt)

  def contains(id: String): Fox[Boolean] =
    withCommands(cmd => Fox.fromFuture(cmd.exists(id).asScala.map(_.longValue > 0)))

  def remove(id: String): Fox[Unit] =
    withCommands(cmd => Fox.fromFuture(cmd.del(id).asScala.map(_ => ())))

  // Set or update expiry duration for an existing key
  def expire(id: String, expiry: FiniteDuration): Fox[Unit] =
    withCommands(cmd => Fox.fromFuture(cmd.expire(id, expiry.toSeconds).asScala.map(_ => ())))

  // Seconds until id expires. -1 if id has no expiration, -2 if id does not exist.
  def ttlSeconds(id: String): Fox[Long] =
    withCommands(cmd => Fox.fromFuture(cmd.ttl(id).asScala.map(_.longValue)))

  def checkHealth: Fox[Unit] =
    withCommands { cmd =>
      Fox
        .fromFuture(
          cmd.ping().toCompletableFuture.orTimeout(connectionTimeout.toSeconds, TimeUnit.SECONDS).asScala
        )
        .flatMap { reply =>
          if (reply == "PONG") Fox.successful(()) else Fox.failure(s"Unexpected Redis ping reply: $reply")
        }
    } ?-> "Redis health check failed."

  def insertIntoSet(id: String, value: String, expirationOpt: Option[FiniteDuration] = None): Fox[Boolean] =
    withCommands { cmd =>
      for {
        wasAdded <- Fox.fromFuture(cmd.sadd(id, value).asScala.map(_.longValue > 0))
        _ <- Fox.runOptional(expirationOpt)(expiration => Fox.fromFuture(cmd.expire(id, expiration.toSeconds).asScala))
      } yield wasAdded
    }

  def isContainedInSet(id: String, value: String): Fox[Boolean] =
    withCommands(cmd => Fox.fromFuture(cmd.sismember(id, value).asScala.map(_.booleanValue)))

  def removeFromSet(id: String, value: String): Fox[Boolean] =
    withCommands(cmd => Fox.fromFuture(cmd.srem(id, value).asScala.map(_.longValue > 0)))

  def findSet(id: String): Fox[Set[String]] =
    withCommands(cmd => Fox.fromFuture(cmd.smembers(id).asScala.map(_.asScala.toSet)))

  def findParsed[T: Reads](key: String)(implicit ec: ExecutionContext): Fox[T] =
    for {
      objectString <- find(key)
      parsed <- JsonHelper.parseAs[T](objectString).toFox
    } yield parsed

  def insertSerialized[T: Writes](key: String, value: T, expirationOpt: Option[FiniteDuration] = None): Fox[Unit] = {
    val serialized = Json.stringify(Json.toJson(value))
    insert(key, serialized, expirationOpt)
  }

}
