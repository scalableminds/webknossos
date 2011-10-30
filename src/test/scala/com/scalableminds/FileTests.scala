package com.scalableminds

import _root_.java.io.File
import _root_.junit.framework._
import Assert._
import _root_.scala.xml.XML
import _root_.net.liftweb.util._
import _root_.net.liftweb.common._
import org.specs2.mutable.Specification

/**
 * Unit test for simple App.
 */
class FileTests extends Specification {
  /**
   * Tests to make sure the project's XML files are well-formed.
   *
   * Finds every *.html and *.xml file in src/main/webapp (and its
   * subdirectories) and tests to make sure they are well-formed.
   */
  "All XML,HTML,XHTML files" should {
    "be well formed" in {
      val files = grabFiles(new File("src/main/webapp"))
      val invalid = files.filterNot(_ match {
        case f if (handledXml(f.getName)) => isValidXML(f)
        case f if (handledXHtml(f.getName)) => isValidXHTML(f)
        case _ => true
      })
      if (invalid.isEmpty)
        ok
      else
        ko("Malformed XML in " + invalid.size + " File(s): " + invalid.mkString(", "))
    }
  }

  def handledXml(file: String) =
    file.endsWith(".xml")

  def handledXHtml(file: String) =
    file.endsWith(".html") || file.endsWith(".htm") || file.endsWith(".xhtml")

  def grabFiles(file: File): List[File] = {
    var files: List[File] = Nil
    if (file.isDirectory)
      for (f <- file.listFiles) files = files ::: grabFiles(f)
    else
      files = file :: files
    files
  }

  def isValidXHTML(file: File): Boolean = {
    PCDataXmlParser(new _root_.java.io.FileInputStream(file.getAbsolutePath)) match {
      case Full(_) => true
      case _ => false
    }
  }

  def isValidXML(file: File): Boolean = {
    try {
      import java.io.FileInputStream
      val fis = new FileInputStream(file)
      try {
        XML.load(fis)
      } finally {
        fis.close()
      }
    } catch {
      case e: _root_.org.xml.sax.SAXParseException => return false
    }
    return true
  }
}
