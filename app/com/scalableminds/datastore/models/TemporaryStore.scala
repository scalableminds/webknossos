/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.models

import akka.agent.Agent
import akka.actor.ActorSystem
import play.api.libs.concurrent.Execution.Implicits._

trait TemporaryStore[T] {
  implicit val system: ActorSystem

  lazy val ts = Agent[Map[String, T]](Map())

  def find(id: String) =
    ts().get(id)

  def findAll =
    ts().values.toList

  def removeAll =
    ts.send(Map.empty[String, T])

  def removeAllExcept(l: Array[String]) =
    ts.send( _.filterKeys( l.contains))

  def insert(id: String, t: T) =
    ts.send(_ + (id -> t))

  def insertAll(els: (String, T)*) =
    ts.send(_ ++ els)

  def remove(id: String) =
    ts.send(_ - id)
}