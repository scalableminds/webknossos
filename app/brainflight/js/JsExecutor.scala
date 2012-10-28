package brainflight.js

import javax.script.ScriptEngineManager
import javax.script.ScriptContext
import collection.JavaConversions._

class JsExecutor {
  // create a script engine manager
  val factory = new ScriptEngineManager()
  // create a JavaScript engine
  val engine = factory.getEngineByName("JavaScript")

  val functionDef = "function executeMe(%s) { %s }; executeMe(%s);"

  def execute(fktBody: String, params: Map[String, Any]) = {
    try {

      val paramDef = params.keys.mkString(", ")
      val fkt = functionDef.format(paramDef, fktBody, paramDef)

      val bindings = engine.getBindings(ScriptContext.ENGINE_SCOPE)

      bindings.putAll(params)
      // evaluate JavaScript code from String
      engine eval fkt
    } catch {
      case e: Exception =>
        System.err.println("Cached an Exception:")
        e.printStackTrace()
    }
  }
}