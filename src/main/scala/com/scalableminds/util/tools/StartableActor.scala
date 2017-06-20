/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import akka.actor.{Actor, Props}

import scala.reflect.ClassTag

trait StartableActor[T <: Actor] {
  def name: String
  def start(implicit sys: akka.actor.ActorSystem, tag: ClassTag[T]) =
    sys.actorOf(Props[T], name)
}
