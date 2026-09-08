package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.{Fox, FoxIterator}
import com.scalableminds.webknossos.tracingstore.tracings.volume.ReversionHelper

import scala.concurrent.ExecutionContext

// Wraps a VersionedFossilDbIterator: skips reverted entries, then applies `transform` to build each output
// element. transform returning None (e.g. the payload fails to parse) skips the entry too.
class ReversionAwareVersionedFossilDbIterator[T](
    prefix: String,
    fossilDbClient: FossilDBClient,
    version: Option[Long] = None
)(transform: VersionedKeyValuePair[Array[Byte]] => Option[T])(implicit ec: ExecutionContext)
    extends FoxIterator[T]
    with ReversionHelper {

  private val rawIterator = new VersionedFossilDbIterator(prefix, fossilDbClient, version)

  override def next(): Fox[T] =
    for {
      keyValuePair <- rawIterator.next()
      result <-
        if (isRevertedElement(keyValuePair)) next()
        else
          transform(keyValuePair) match {
            case Some(value) => Fox.successful(value)
            case None        => next()
          }
    } yield result

}
