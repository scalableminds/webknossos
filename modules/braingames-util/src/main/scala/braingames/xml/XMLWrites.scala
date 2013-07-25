package braingames.xml

import scala.xml.Node
import scala.concurrent.Future

trait XMLWrites[-T] {

  /**
   * Convert the object into a JsValue
   */
  def writes(o: T): Future[Node]
}

trait SynchronousXMLWrites[-T] extends XMLWrites[T] {

  def writes(o: T) =
    Future.successful(synchronousWrites(o))

  def synchronousWrites(o: T): Node
}