package brainflight.js

import javax.script.ScriptEngineManager
import javax.script.ScriptContext
import collection.JavaConversions._
import play.api.libs.concurrent.Akka
import play.api.Play.current
import scala.concurrent.duration._
import play.api.Logger
import scala.util._
import scala.concurrent.Promise

class JsExecutor {
  // create a script engine manager
  val factory = new ScriptEngineManager()
  // create a JavaScript engine
  val engine = factory.getEngineByName("JavaScript")

  val functionDef = "var executeMe = %s; executeMe(%s);"

  def execute(fktBody: String, params: Map[String, Any]) = {
    val paramDef = params.keys.mkString(", ")
    val fkt = functionDef.format(fktBody, paramDef)
    implicit val excetutionContext = Akka.system.dispatcher

    val bindings = engine.getBindings(ScriptContext.ENGINE_SCOPE)
    bindings.putAll(params)
    val promise = Promise[Object]()
    // evaluate JavaScript code from String
    val jsThread = new Thread(new Runnable {
      def run() {
        promise complete {
          try {
            Success(engine eval fkt)
          } catch {
            case e: Exception =>
              System.err.println("Cached an Exception:")
              e.printStackTrace()
              Failure(e)
          }
        }
      }
    })
    jsThread.start()
    Akka.system.scheduler.scheduleOnce(5 seconds) {
      if(!promise.isCompleted){
        Logger.warn("Destroying JS executer: Runntime expired.")
        jsThread.stop()
        promise.complete(Failure(new Exception("Exceution timeout.")))
      }
    }
    promise.future
  }
}