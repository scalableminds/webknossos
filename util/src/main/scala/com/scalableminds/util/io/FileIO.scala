package com.scalableminds.util.io

import java.io._
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.{Box, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import org.apache.commons.io.IOUtils
import play.api.libs.json.{Json, Writes}

import java.nio.charset.Charset
import scala.concurrent.ExecutionContext

trait NamedStream {
  def name: String

  def normalizedName: String = {
    val sep = File.separatorChar
    if (sep == '/')
      name
    else
      name.replace(sep, '/')
  }

  def writeTo(out: OutputStream)(implicit ec: ExecutionContext): Fox[Unit]
}

object NamedFunctionStream {
  def fromBytes(name: String, bytes: Array[Byte])(implicit ec: ExecutionContext): NamedFunctionStream =
    NamedFunctionStream(name, os => Fox.successful(os.write(bytes)))

  def fromString(name: String, str: String)(implicit ec: ExecutionContext): NamedFunctionStream =
    fromBytes(name, str.getBytes(Charset.forName("UTF-8")))

  def fromJsonSerializable[T](name: String, o: T, prettyPrint: Boolean = true)(
      implicit w: Writes[T],
      ec: ExecutionContext): NamedFunctionStream = {
    val jsValue = w.writes(o)
    val str = if (prettyPrint) Json.prettyPrint(jsValue) else jsValue.toString
    fromString(name, str)
  }
}

case class NamedFunctionStream(name: String, writer: OutputStream => Fox[Unit]) extends NamedStream {
  def writeTo(out: OutputStream)(implicit ec: ExecutionContext): Fox[Unit] = writer(out)
}

object FileIO {

  def printToFile(s: String)(op: java.io.PrintWriter => Unit): Box[Unit] =
    printToFile(new File(s))(op)

  def printToFile(f: java.io.File)(op: java.io.PrintWriter => Unit): Box[Unit] =
    try {
      val p = new java.io.PrintWriter(f)
      try {
        op(p)
        Full(())
      } catch {
        case ex: Exception =>
          Failure(ex.getMessage)
      } finally {
        p.close()
      }
    } catch {
      case ex: Exception =>
        Failure(ex.getMessage)
    }

  def readFileToByteArray(file: File): Box[Array[Byte]] =
    tryo {
      val is = new FileInputStream(file)
      val result = IOUtils.toByteArray(is)
      is.close()
      result
    }
}
