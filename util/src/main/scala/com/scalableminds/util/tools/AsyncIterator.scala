package com.scalableminds.util.tools

trait AsyncIterator[+A] {
  def nextBatch(): Fox[List[A]]
}
