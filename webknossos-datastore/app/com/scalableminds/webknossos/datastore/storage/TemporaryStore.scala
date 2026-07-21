package com.scalableminds.webknossos.datastore.storage

import org.apache.pekko.actor.ActorSystem

import javax.inject.Inject
import scala.collection.concurrent.TrieMap
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class TemporaryStore[K, V] @Inject() (system: ActorSystem) {

  private val map: TrieMap[K, V] = TrieMap()

  def get(id: K): Option[V] =
    map.get(id)

  def contains(id: K): Boolean =
    map.contains(id)

  def getAll: Seq[V] =
    map.values.toList

  def getMultiple(ids: Seq[K]): Seq[Option[V]] =
    ids.map(map.get)

  def getAllConditionalWithKey(predicate: K => Boolean): Map[K, V] =
    map.view.filterKeys(predicate).toMap

  def removeAll(): Unit =
    map.clear()

  def removeAllExcept(l: Array[K]): collection.Map[K, V] =
    map.view.filterKeys(l.contains).toMap

  def removeAllConditional(predicate: K => Boolean): Unit =
    map.keySet.filter(predicate).foreach { (key: K) =>
      map -= key
    }

  def insert(id: K, t: V, to: Option[FiniteDuration] = None)(implicit ec: ExecutionContext): Unit = {
    map += (id -> t)
    to.foreach(system.scheduler.scheduleOnce(_)(remove(id)))
  }

  def insertAll(elements: Seq[(K, V)], to: Option[FiniteDuration] = None)(implicit ec: ExecutionContext): Unit = {
    map ++= elements
    to.foreach(system.scheduler.scheduleOnce(_)(removeMultiple(elements.map(_._1))))
  }

  def remove(id: K): TrieMap[K, V] =
    map -= id

  def pop(id: K): Option[V] =
    map.remove(id)

  private def removeMultiple(ids: Seq[K]): TrieMap[K, V] =
    map --= ids
}
