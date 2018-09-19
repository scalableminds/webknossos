package com.scalableminds.webknossos.datastore.storage

import akka.actor.{Actor, ActorLogging, ActorSystem}
import akka.agent.Agent
import javax.inject.Inject

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.stm.Ref

class TemporaryStore[K, V] @Inject()(system: ActorSystem) {

  lazy val ts = Agent[Map[K, V]](Map())

  def find(id: K) =
    ts().get(id)

  def findAll =
    ts().values.toList

  def removeAll =
    ts.send(Map.empty[K, V])

  def removeAllExcept(l: Array[K]) =
    ts.send(_.filterKeys(l.contains))

  def insert(id: K, t: V, to: Option[FiniteDuration] = None) = {
    ts.send(_ + (id -> t))
    to.foreach(system.scheduler.scheduleOnce(_)(remove(id)))
  }

  def insertAll(els: (K, V)*) =
    ts.send(_ ++ els)

  def remove(id: K) =
    ts.send(_ - id)
}

// New

object MyActor{
  case class Find[K](id: K)
  case class FindAll[K]()
  case class RemoveAll[K]()
  case class RemoveAllExcept[K](l: Array[K])
  case class Insert[K, V](id: K, t: V, to: Option[FiniteDuration] = None)
  case class InsertAll[K, V](els: (K,V)*)
  case class Remove[K](id: K)

  def apply[K,V](initialMap: Map[K, V]): MyActor[K, V] = new MyActor[K, V](initialMap)
}

class MyActor[K, V](initialMap: Map[K, V]) extends Actor {
  private val ref = Ref[Map[K,V]](initialMap)

  private def getMap() = ref.single.get

  def receive[K,V] = {
    case MyActor.Find(id: K)        => getMap().get(id)
    case MyActor.FindAll            => getMap().values.toList
    case MyActor.RemoveAll          => // TODO
    case MyActor.RemoveAllExcept(l) => // TODO
    case MyActor.Insert(id, t, to)  => // TODO
    case MyActor.InsertAll(els)     => // TODO
    case MyActor.Remove(id)         => // TODO
  }
}
