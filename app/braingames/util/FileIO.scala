package braingames.util

import java.io.File

object FileIO {
  def printToFile(s: String)(op: java.io.PrintWriter => Unit) {
    printToFile(new File(s))(op)
  }
  
  def printToFile(f: java.io.File)(op: java.io.PrintWriter => Unit) {
    val p = new java.io.PrintWriter(f)
    try { op(p) } finally { p.close() }
  }
}