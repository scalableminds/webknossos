/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

case class LazyLogger(logger: org.apache.logging.log4j.Logger) {
  def trace(s: => String) { if (logger.isTraceEnabled) logger.trace(s) }
  def trace(s: => String, e: => Throwable) { if (logger.isTraceEnabled) logger.trace(s, e) }
  def debug(s: => String) { if (logger.isDebugEnabled) logger.debug(s) }
  def debug(s: => String, e: => Throwable) { if (logger.isDebugEnabled) logger.debug(s, e) }
  def info(s: => String) { if (logger.isInfoEnabled) logger.info(s) }
  def info(s: => String, e: => Throwable) { if (logger.isInfoEnabled) logger.info(s, e) }
  def warn(s: => String) { if (logger.isWarnEnabled) logger.warn(s) }
  def warn(s: => String, e: => Throwable) { if (logger.isWarnEnabled) logger.warn(s, e) }
  def error(s: => String) { if (logger.isErrorEnabled) logger.error(s) }
  def error(s: => String, e: => Throwable) { if (logger.isErrorEnabled) logger.error(s, e) }
}

object LazyLogger {
  def apply(logger: String): LazyLogger = LazyLogger(org.apache.logging.log4j.LogManager.getLogger(logger))
}
