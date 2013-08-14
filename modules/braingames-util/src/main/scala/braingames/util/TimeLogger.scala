package braingames.util

object TimeLogger {
  def logTime[A](caption: String, log: ( => String) => Unit)(op: => A): A = { 
    val t = System.currentTimeMillis()
    val result = op
    log(s"TIMELOG | $caption took ${System.currentTimeMillis-t} ms")
    result
  }
}