/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

object TimeLogger {
  def logTime[A](caption: String, log: ( => String) => Unit)(op: => A): A = { 
    val t = System.currentTimeMillis()
    val result = op
    log(s"TIMELOG | $caption took ${System.currentTimeMillis-t} ms")
    result
  }
}