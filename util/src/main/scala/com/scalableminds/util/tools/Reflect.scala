/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

import scala.util.control.NonFatal

/**
 * Collection of internal reflection utilities which may or may not be
 * available (most services specific to HotSpot, but fails gracefully).
 */
object Reflect {

  /**
   * This optionally holds a function which looks N levels above itself
   * on the call stack and returns the `Class[_]` object for the code
   * executing in that stack frame. Implemented using
   * `sun.reflect.Reflection.getCallerClass` if available, None otherwise.
   *
   * Hint: when comparing to Thread.currentThread.getStackTrace, add two levels.
   */
  val getCallerClass: Option[Int ⇒ Class[_]] = {
    try {
      val c = Class.forName("sun.reflect.Reflection");
      val m = c.getMethod("getCallerClass", Array(classOf[Int]): _*)
      Some((i: Int) ⇒ m.invoke(null, Array[AnyRef](i.asInstanceOf[java.lang.Integer]): _*).asInstanceOf[Class[_]])
    } catch {
      case NonFatal(e) ⇒ None
    }
  }
}