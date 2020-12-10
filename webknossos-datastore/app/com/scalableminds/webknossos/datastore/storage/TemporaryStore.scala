package com.scalableminds.webknossos.datastore.storage

import akka.actor.ActorSystem

import javax.inject.Inject
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration

class TemporaryStore[K, V] @Inject()(system: ActorSystem) {

  lazy val map: scala.collection.mutable.Map[K, V] = scala.collection.mutable.Map()

  def find(id: K) =
    map.synchronized {
      map.get(id)
    }

  def contains(id: K) =
    map.synchronized(
      map.contains(id)
    )

  def findAll =
    map.synchronized {
      map.values.toList
    }

  def findAllConditionalWithKey(predicate: K => Boolean): scala.collection.Map[K, V] =
    map.synchronized {
      map.filterKeys(predicate)
    }

  def removeAll =
    map.synchronized {
      map.clear()
    }

  def removeAllExcept(l: Array[K]) =
    map.synchronized {
      map.filterKeys(l.contains)
    }

  def removeAllConditional(predicate: K => Boolean) =
    map.synchronized {
      map.keySet.filter(predicate).foreach { key: K =>
        map -= key
      }
    }

  def insert(id: K, t: V, to: Option[FiniteDuration] = None) = {
    map.synchronized {
      map += (id -> t)
    }
    to.foreach(system.scheduler.scheduleOnce(_)(remove(id)))
  }

  def insertAll(els: (K, V)*) =
    map.synchronized {
      map ++= els
    }

  def remove(id: K) =
    map.synchronized {
      map -= id
    }
}
