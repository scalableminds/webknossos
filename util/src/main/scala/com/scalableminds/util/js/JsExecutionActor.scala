/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.js

import akka.actor.Actor

case class JS(fktBody: String, params: Map[String, Any])

class JsExecutionActor extends Actor {
  lazy val jsExecutor = new JsExecutor(context.system.scheduler)

  def receive = {
    case JS(fktBody, params) =>
      sender ! jsExecutor.execute(fktBody, params)
  }
} 
