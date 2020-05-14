package com.scalableminds.webknossos.datastore.storage

import akka.actor.{Actor, ActorLogging, ActorSystem}
import akka.agent.Agent
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.stm.Ref

class TemporaryStore[K, V] @Inject()(system: ActorSystem) extends LazyLogging {

  lazy val map: scala.collection.mutable.Map[K, V] = scala.collection.mutable.Map()

  def find(id: K, log: Boolean = false) =
    map.synchronized {
      if (log) {logger.info(s"temporaryStore $this find $id")}
      map.get(id)
    }

  def contains(id: K) =
    map.synchronized(
      map.contains(id)
    )

  def findAll(log: Boolean = false) =
    map.synchronized {
      if (log) {logger.info(s"temporaryStore $this findAll")}
      if (log) {logger.info(s"findAll values: ${map.values}")}
      map.values.toList
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

  def insert(id: K, t: V, to: Option[FiniteDuration] = None, log: Boolean = false) = {
    map.synchronized {
      if (log) {logger.info(s"temporaryStore $this insert $id")}
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
