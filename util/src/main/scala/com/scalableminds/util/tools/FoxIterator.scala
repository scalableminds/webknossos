package com.scalableminds.util.tools

import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.tools.Fox.toFox

import scala.concurrent.ExecutionContext

trait FoxIterator[+A] { self =>
  // Fetches the next element. Fox.empty signals the iterator is exhausted. A failed fetch is a Fox failure.
  def next(): Fox[A]

  def map[B](f: A => B): FoxIterator[B] = () => self.next().map(f)

  // Maps each element to Some(value) to keep it (transformed) or None to skip it.
  def flatMap[B](f: A => Option[B])(implicit ec: ExecutionContext): FoxIterator[B] = new FoxIterator[B] {
    override def next(): Fox[B] =
      self.next().flatMap { a =>
        f(a) match {
          case Some(b) => Fox.successful(b)
          case None    => next()
        }
      }
  }

  // Yields this iterator's elements, then other's, once this one is exhausted.
  def concat[B >: A](other: FoxIterator[B])(implicit ec: ExecutionContext): FoxIterator[B] = new FoxIterator[B] {
    private var selfExhausted = false

    override def next(): Fox[B] =
      if (selfExhausted) other.next()
      else
        self.next().shiftBox.flatMap {
          case Full(item) => Fox.successful(item)
          case Empty      =>
            selfExhausted = true
            other.next()
          case failure: Failure => failure.toFox
        }
  }

  // Runs f on every element in turn, failing on the first failed fetch. f itself is not expected to fail.
  def foreach(f: A => Unit)(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.serialCombined(self)(a => Fox.successful(f(a))).map(_ => ())
}

// Forwards a plain synchronous Iterator as a FoxIterator, for callers that need to hand an in-memory
// (already-fetched) sequence to a Fox-based combinator like Fox.serialCombined.
class SyncFoxIterator[A](iterator: Iterator[A])(implicit ec: ExecutionContext) extends FoxIterator[A] {
  override def next(): Fox[A] =
    if (iterator.hasNext) Fox.successful(iterator.next())
    else Fox.empty
}
