package com.scalableminds.util.tools

trait FoxIterator[A] {
  // Fetches the next element. Fox.empty signals the iterator is exhausted. A failed fetch is a Fox failure.
  def next(): Fox[A]
}
