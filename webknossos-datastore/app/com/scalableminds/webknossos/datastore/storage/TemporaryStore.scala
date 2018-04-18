/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.storage

import akka.actor.ActorSystem
import akka.agent.Agent

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration

trait TemporaryStore[K, V] {

  implicit val system: ActorSystem

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
