/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository.mapping

import java.io.{File, Writer, FileWriter}
import java.nio.file.Path
import org.scalastuff.json._

import com.scalableminds.braingames.binary.models.DataLayerMapping

class MappingPrinter {

  private def printStringMember(name: String, valueOpt: Option[String])(implicit printer: JsonPrinter) {
    valueOpt.map{
      value =>
        printer.startMember(name)
        printer.string(value)
    }
  }

  private def printClasses(name: String, classesOpt: Option[List[List[Long]]])(implicit printer: JsonPrinter) {
    classesOpt.map{
      classes =>
        printer.startMember(name)
        printer.startArray()
        classes.foreach{
          c =>
            printer.startArray()
            c.foreach(id => printer.number(id.toString))
            printer.endArray()
        }
        printer.endArray()
    }
  }

  def print(m: DataLayerMapping, w: Writer): Unit = {
    implicit val printer = new JsonPrinter(w)

    printer.startObject()

    printStringMember("name", Some(m.name))
    printStringMember("parent", m.parent)
    printStringMember("path", m.path)
    printClasses("classes", m.classes)

    w.close()
  }

  def print(m: DataLayerMapping, s: String): Unit =
    print(m, new FileWriter(new File(s)))

  def print(m: DataLayerMapping, p: Path): Unit =
    print(m, p.toString)
}

object MappingPrinter {
  def print(m: DataLayerMapping, w: Writer) =
    new MappingPrinter().print(m, w)

  def print(m: DataLayerMapping, s: String) = 
    new MappingPrinter().print(m, s)

  def print(m: DataLayerMapping, p: Path) = 
    new MappingPrinter().print(m, p)
}
