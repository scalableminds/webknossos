package com.scalableminds.util.cache

import com.github.benmanes.caffeine.cache.{AsyncCache, Caffeine, RemovalCause, RemovalListener, Weigher}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Failure}

import java.util.concurrent.{CompletableFuture, Executor, TimeUnit}
import java.util.function.BiFunction
import scala.jdk.FunctionWrappers.AsJavaBiFunction
import scala.jdk.FutureConverters.{CompletionStageOps, FutureOps}
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.jdk.CollectionConverters._

class AlfuCache[K, V](store: AsyncCache[K, Box[V]]) extends FoxImplicits {

  def getOrLoad(key: K, loadFn: K => Fox[V])(implicit ec: ExecutionContext): Fox[V] =
    for {
      box <- Fox.future2Fox(getOrLoadAdapter(key, key => loadFn(key).futureBox))
      _ = box match {
        case _: Failure => remove(key) // Do not cache failures
        case _          => ()
      }
      result <- box.toFox
    } yield result

  private def getOrLoadAdapter(key: K, loadValue: K => Future[Box[V]]): Future[Box[V]] =
    store.get(key, AlfuCache.toJavaMappingFunction[K, Box[V]](loadValue)).asScala

  def remove(key: K): Unit = store.synchronous().invalidate(key)

  def clear(fn: K => Boolean): Int = {
    val keysToRemove = keys.filter(fn(_))
    keysToRemove.foreach(remove)
    keysToRemove.size
  }

  def clear(): Unit = store.synchronous().invalidateAll()

  def keys: Set[K] = store.synchronous().asMap().keySet().asScala.toSet

}

object AlfuCache {

  def apply[K, V](maxCapacity: Int = 1000,
                  timeToLive: FiniteDuration = 2 hours,
                  timeToIdle: FiniteDuration = 1 hour,
                  weighFn: Option[(K, Box[V]) => Int] = None,
                  onRemovalFn: Option[(K, Box[V]) => Unit] = None): AlfuCache[K, V] = {
    val weigher = weighFn.map { weigh =>
      new CacheItemWeigher(weigh)
    }.getOrElse(Weigher.singletonWeigher[K, Box[V]])

    def addEvictionListener(builder: Caffeine[K, Box[V]]): Caffeine[K, Box[V]] =
      onRemovalFn.map { removalFn =>
        builder.evictionListener(new CacheRemovalListener(removalFn)).asInstanceOf[Caffeine[K, Box[V]]]
      }.getOrElse(builder)

    val builder =
      Caffeine
        .newBuilder()
        .asInstanceOf[Caffeine[K, Box[V]]]
        .initialCapacity(500)
        .maximumWeight(maxCapacity)
        .expireAfterWrite(timeToLive.toMillis, TimeUnit.MILLISECONDS)
        .expireAfterAccess(timeToIdle.toMillis, TimeUnit.MILLISECONDS)

    val builderWithMoreOptions =
      addEvictionListener(builder).weigher(weigher)

    new AlfuCache(builderWithMoreOptions.buildAsync[K, Box[V]]())
  }

  private def toJavaMappingFunction[K, V](loadValue: K => Future[V]): BiFunction[K, Executor, CompletableFuture[V]] =
    new AsJavaBiFunction[K, Executor, CompletableFuture[V]]((k, _) => loadValue(k).asJava.toCompletableFuture)

}

class CacheItemWeigher[K, V](fn: (K, V) => Int) extends Weigher[K, V] {
  override def weigh(key: K, value: V): Int = fn(key, value)
}

class CacheRemovalListener[K, V](fn: (K, V) => Unit) extends RemovalListener[K, V] {
  override def onRemoval(key: K, value: V, cause: RemovalCause): Unit = fn(key, value)
}
