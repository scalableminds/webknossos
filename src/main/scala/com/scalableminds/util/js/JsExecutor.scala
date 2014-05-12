/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.js

import javax.script.ScriptEngineManager
import javax.script.ScriptContext
import scala.concurrent.duration._
import scala.util._
import scala.concurrent.{Future, Promise}
import scala.concurrent.ExecutionContext.Implicits._
import java.util.concurrent.TimeoutException
import scala.collection.JavaConversions._
import scala.collection.JavaConverters._

class JsExecutor(scheduler: => akka.actor.Scheduler) {
  val functionDef = "var executeMe = %s; executeMe(%s);"

  def execute(fktBody: String, params: Map[String, Any]): Future[Object] = {
    // create a script engine manager
    val factory = new ScriptEngineManager()
    // create a JavaScript engine
    val engine = factory.getEngineByName("JavaScript")

    val paramDef = params.keys.mkString(", ")
    val fkt = functionDef.format(fktBody, paramDef)

    val bindings = engine.getBindings(ScriptContext.ENGINE_SCOPE)
    bindings.putAll(params)
    val promise = Promise[Object]()
    // evaluate JavaScript code from String
    val jsThread = new Thread(new Runnable {
      def run() {
        promise complete {
          Try {
            engine eval fkt
          }
        }
      }
    })
    jsThread.start()
    scheduler.scheduleOnce(5 seconds) {
      if (!promise.isCompleted) {
        jsThread.stop()
        promise.failure(new TimeoutException("Exceution timeout."))
      }
    }
    promise.future
  }
}