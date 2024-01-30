package com.scalableminds.webknossos.datastore.dataformats.wkw.util

import net.liftweb.common.Box
import net.liftweb.common.{Failure => BoxFailure}
import net.liftweb.common.Box.tryo

import scala.util.Using.Releasable
import scala.util.{Success, Using, Failure => TryFailure}

object ResourceBox {
  def apply[R: Releasable](resource: => R): Box[R] =
    tryo(resource) ~> "Exception during resource creation"

  def manage[R: Releasable, T](resource: => R)(f: R => Box[T]): Box[T] =
    for {
      r <- ResourceBox(resource)
      result <- Using.Manager { use =>
        f(use(r))
      } match {
        case TryFailure(ex) =>
          BoxFailure(s"Exception during resource management: ${ex.toString}")
        case Success(result) =>
          result
      }
    } yield result
}
