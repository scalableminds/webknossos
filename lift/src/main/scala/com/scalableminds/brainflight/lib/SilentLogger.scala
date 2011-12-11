package com.scalableminds.brainflight.lib

import sys.process.ProcessLogger

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 08.11.11
 * Time: 11:14
 */

class ScalaSilentLogger extends ProcessLogger{
  def out(s: => String) {}

  def err(s: => String) {}

  def buffer[T](f: => T) = f
}