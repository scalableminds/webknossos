package braingames.util

import java.io.File
import java.io.PrintWriter

object FileIO {
  def printToFile(s: String)(op: java.io.PrintWriter => Unit) {
    printToFile(new File(s))(op)
  }

  def printToFile(f: java.io.File)(op: java.io.PrintWriter => Unit) {
    val p = new java.io.PrintWriter(f)
    try { op(p) } finally { p.close() }
  }

  def createTempFile(data: String, fileType: String = ".tmp") = {
    val temp = File.createTempFile("temp", System.nanoTime().toString + fileType)
    val out = new PrintWriter(temp)
    try { out.print(data) }
    finally { out.close }
    temp
  }
}