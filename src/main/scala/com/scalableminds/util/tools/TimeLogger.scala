/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import scala.concurrent.{ExecutionContext, Future}

object TimeLogger {
  def logTime[A](caption: String, log: String => Unit)(op: => A): A = {
    val t = System.currentTimeMillis()
    val result = op
    log(s"TIMELOG | $caption took ${System.currentTimeMillis-t} ms")
    result
  }

  def logTimeF[A](caption: String, log: String => Unit)(op: => Fox[A])(implicit ec: ExecutionContext): Fox[A] = {
    val t = System.currentTimeMillis()
    val result = op
    result.futureBox.onComplete(_ => log(s"TIMELOG | $caption took ${System.currentTimeMillis - t} ms"))
    result
  }
}