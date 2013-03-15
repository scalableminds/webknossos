package braingames.util

import play.api.Logger

object TimeLogger {
  def logTime[A](caption: String)(op: => A): A = { 
    val t = System.currentTimeMillis()
    val result = op
    Logger.debug(s"TIMELOG | $caption took ${System.currentTimeMillis-t} ms")
    result
  }
}