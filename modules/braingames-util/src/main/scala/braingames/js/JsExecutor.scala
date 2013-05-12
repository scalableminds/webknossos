package braingames.js

import javax.script.ScriptEngineManager
import javax.script.ScriptContext
import collection.JavaConversions._
import scala.concurrent.duration._
import scala.util._
import scala.concurrent.Promise
import scala.concurrent.ExecutionContext.Implicits._
import java.util.concurrent.TimeoutException

class JsExecutor(scheduler: => akka.actor.Scheduler) {
  val functionDef = "var executeMe = %s; executeMe(%s);"

  def execute(fktBody: String, params: Map[String, Any]) = {
    // create a script engine manager
    val factory = new ScriptEngineManager()
    // create a JavaScript engine
    val engine = factory.getEngineByName("JavaScript")

    val paramDef = params.keys.mkString(", ")
    val fkt = functionDef.format(fktBody, paramDef)

    val bindings = engine.getBindings(ScriptContext.ENGINE_SCOPE)
    bindings.putAll(params)
    val promise = Promise[Try[Object]]()
    // evaluate JavaScript code from String
    val jsThread = new Thread(new Runnable {
      def run() {
        promise complete {
          Try{
            Success(engine eval fkt)
          }
        }
      }
    })
    jsThread.start()
    scheduler.scheduleOnce(5 seconds) {
      if (!promise.isCompleted) {
        jsThread.stop()
        promise.complete(Failure(new TimeoutException("Exceution timeout.")))
      }
    }
    promise.future
  }
}