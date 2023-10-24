package com.scalableminds.webknossos.datastore.storage

import akka.actor.ActorSystem

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class TemporaryStore[K, V] @Inject()(system: ActorSystem) {

  lazy val map: scala.collection.mutable.Map[K, V] = scala.collection.mutable.Map()

  def find(id: K): Option[V] =
    map.synchronized {
      map.get(id)
    }

  def contains(id: K): Boolean =
    map.synchronized(
      map.contains(id)
    )

  def findAll: Seq[V] =
    map.synchronized {
      map.values.toList
    }

  def findAllConditionalWithKey(predicate: K => Boolean): scala.collection.Map[K, V] =
    map.synchronized {
      map.view.filterKeys(predicate).toMap
    }

  def removeAll(): Unit =
    map.synchronized {
      map.clear()
    }

  def removeAllExcept(l: Array[K]): collection.Map[K, V] =
    map.synchronized {
      map.view.filterKeys(l.contains).toMap
    }

  def removeAllConditional(predicate: K => Boolean): Unit =
    map.synchronized {
      map.keySet.filter(predicate).foreach { key: K =>
        map -= key
      }
    }

  def insert(id: K, t: V, to: Option[FiniteDuration] = None)(implicit ec: ExecutionContext): Unit = {
    map.synchronized {
      map += (id -> t)
    }
    to.foreach(system.scheduler.scheduleOnce(_)(remove(id)))
  }

  def insertAll(els: (K, V)*): map.type =
    map.synchronized {
      map ++= els
    }

  def remove(id: K): map.type =
    map.synchronized {
      map -= id
    }
}
