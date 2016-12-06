/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.io

import java.io._

import com.scalableminds.util.tools.Fox
import play.api.libs.iteratee.{Enumerator, Iteratee}

import scala.concurrent.{Future, blocking}
import play.api.libs.concurrent.Execution.Implicits._


trait NamedStream {
  def name: String

  def normalizedName: String = {
    val sep = File.separatorChar
    if (sep == '/')
      name
    else
      name.replace(sep, '/')
  }

  def writeTo(out: OutputStream): Future[Unit]
}

case class NamedFunctionStream(name: String, writer: OutputStream => Future[Unit]) extends NamedStream {
  def writeTo(out: OutputStream) = writer(out)
}

case class NamedEnumeratorStream(enumerator: Enumerator[Array[Byte]], name: String) extends NamedStream {
  def writeTo(out: OutputStream) = {
    val iteratee = Iteratee.foreach[Array[Byte]] { bytes =>
      out.write(bytes)
    }
    enumerator |>>> iteratee
  }
}

case class NamedFileStream(file: File, name: String) extends NamedStream{
  def stream(): InputStream =  new FileInputStream(file)

  def writeTo(out: OutputStream): Future[Unit] = {
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
}

object FileIO {
  def printToFile(s: String)(op: java.io.PrintWriter => Unit): Unit = {
    printToFile(new File(s))(op)
  }

  def printToFile(f: java.io.File)(op: java.io.PrintWriter => Unit): Unit = {
    val p = new java.io.PrintWriter(f)
    try {
      op(p)
    } finally {
      p.close()
    }
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
}