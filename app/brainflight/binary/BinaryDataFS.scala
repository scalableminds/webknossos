package brainflight.binary

import java.io._
import java.util.Arrays
import org.jboss.netty.buffer.ChannelBuffer
import play.api.libs.iteratee._
import reactivemongo.api._
import reactivemongo.bson._
import reactivemongo.bson.handlers._
import reactivemongo.bson.handlers.DefaultBSONHandlers._
import reactivemongo.core.commands.{GetLastError, LastError}
import reactivemongo.core.protocol.Response
import reactivemongo.utils.{RichBuffer => _, _}
import scala.concurrent.{Future, ExecutionContext}
import reactivemongo.api.gridfs._

case class BinaryDataFS(d: DB[Collection] with DBMetaCommands, p: String = "fs") extends GridFS(d, p) {
 /**
   * Saves a file with the given name.
   *
   * If an id is provided, the matching file metadata will be replaced.
   *
   * @param name the file name.
   * @param id an id for the new file. If none is provided, a new ObjectId will be generated.
   *
   * @return an iteratee to be applied to an enumerator of chunks of bytes.
   */
  override def save(name: String, id: Option[BSONValue], contentType: Option[String] = None)(implicit ctx: ExecutionContext) :Iteratee[Array[Byte], Future[PutResult]] = 
    FileToWrite(id, name, contentType).iteratee(this, 4194304)

}