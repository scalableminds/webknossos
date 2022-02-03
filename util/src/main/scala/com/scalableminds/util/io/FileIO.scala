package com.scalableminds.util.io

import java.io._

import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.IOUtils
import play.api.libs.iteratee.{Enumerator, Iteratee}

import scala.concurrent.{ExecutionContext, Future, blocking}

trait NamedStream {
  def name: String

  def normalizedName: String = {
    val sep = File.separatorChar
    if (sep == '/')
      name
    else
      name.replace(sep, '/')
  }

  def writeTo(out: OutputStream)(implicit ec: ExecutionContext): Future[Unit]
}

case class NamedFunctionStream(name: String, writer: OutputStream => Future[Unit]) extends NamedStream {
  def writeTo(out: OutputStream)(implicit ec: ExecutionContext): Future[Unit] = writer(out)
}

case class NamedEnumeratorStream(name: String, enumerator: Enumerator[Array[Byte]]) extends NamedStream {
  def writeTo(out: OutputStream)(implicit ec: ExecutionContext): Future[Unit] = {
    val iteratee = Iteratee.foreach[Array[Byte]] { bytes =>
      out.write(bytes)
    }
    enumerator |>>> iteratee
  }
}

case class NamedFileStream(name: String, file: File) extends NamedStream {
  def stream(): InputStream = new FileInputStream(file)

  def writeTo(out: OutputStream)(implicit ec: ExecutionContext): Future[Unit] =
    Future {
      blocking {
        val in = stream()
        val buffer = new Array[Byte](1024)
        var len = 0
        do {
          len = in.read(buffer)
          if (len > 0)
            out.write(buffer, 0, len)
        } while (len > 0)
        in.close()
      }
    }
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

  def createTempFile(data: String, fileType: String = ".tmp"): File = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + fileType)
    val out = new PrintWriter(temp)
    try {
      out.print(data)
    } finally {
      out.close()
    }
    temp
  }

  def readFileToByteArray(file: File): Box[Array[Byte]] =
    tryo {
      val is = new FileInputStream(file)
      val result = IOUtils.toByteArray(is)
      is.close()
      result
    }
}
