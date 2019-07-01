package com.scalableminds.util.tools

import com.typesafe.scalalogging.Logger

import scala.concurrent.ExecutionContext

object TimeLogger {
  def logTime[A](caption: String, logger: Logger)(op: => A): A = {
    val t = System.currentTimeMillis()
    val result = op
    logger.info(s"TIMELOG | $caption took ${System.currentTimeMillis - t} ms")
    result
  }

  def logTimeF[A](caption: String, logger: Logger)(op: => Fox[A])(implicit ec: ExecutionContext): Fox[A] = {
    val t = System.currentTimeMillis()
    val result = op
    result.futureBox.onComplete(_ => logger.info(s"TIMELOG | $caption took ${System.currentTimeMillis - t} ms"))
    result
  }
}
