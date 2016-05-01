/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository.mapping

import com.scalableminds.braingames.binary.Logger

import scala.collection.mutable.MutableList
import org.scalastuff.json._
import net.liftweb.common.{Empty, Full, Box}

import com.scalableminds.braingames.binary.models.DataLayerMapping

class MappingBuilder extends JsonHandler {

  object Token extends Enumeration {
    type Token = Value
    val MappingStart,
        MemberName,
        NameValue,
        ParentValue,
        PathValue,
        ClassesStart,
        ClassStart,
        ClassValue,
        Nothing = Value
  }
  import Token._

  var name: Box[String] = Empty
  var parent: Option[String] = None
  var path: Option[String] = None
  var classes: Box[MutableList[MutableList[Long]]] = Empty

  var expectedToken: Token = MappingStart

  def reset() {
    name = Empty
    parent = None
    path = None
    classes = Empty
    expectedToken = MappingStart
  }

  def result =
    for {
      nameVal <- name ~> "Mapping name not specified."
      classesVal <- classes ~> "No classes specified in mapping."
    } yield {
      DataLayerMapping(nameVal, parent, path, Some(classesVal.map(_.toList).toList))
    }

  def startObject() =
    expectedToken = expectedToken match {
      case MappingStart => MemberName
      case _ => throw new IllegalStateException
    }

  def startMember(name: String) =
    expectedToken = expectedToken match {
      case MemberName =>
        name.toLowerCase match {
          case "name" => NameValue
          case "parent" => ParentValue
          case "path" => PathValue
          case "classes" => ClassesStart
          case _ => throw new IllegalStateException
        }
      case _ => throw new IllegalStateException
    }

  def endObject() =
    expectedToken = expectedToken match {
      case MemberName => Nothing
      case _ => throw new IllegalStateException
    }

  def startArray() =
    expectedToken = expectedToken match {
      case ClassesStart =>
        classes = Full(MutableList())
        ClassStart
      case ClassStart =>
        classes.map(_ += MutableList())
        ClassValue
      case _ => throw new IllegalStateException
    }

  def endArray() =
    expectedToken = expectedToken match {
      case ClassStart => MemberName
      case ClassValue => ClassStart
      case _ => throw new IllegalStateException
    }

  def number(n: String) =
    expectedToken = expectedToken match {
      case ClassValue =>
        classes.map(_.last += n.toLong)
        ClassValue
      case _ =>
        throw new IllegalStateException(s"Expected current state: '$expectedToken' expected: 'ClassValue'. Found number: '$n'. Name: '$name")
    }

  def string(s: String) =
    expectedToken = expectedToken match {
      case NameValue =>
        name = Some(s)
        MemberName
      case ParentValue =>
        parent = Some(s)
        MemberName
      case PathValue =>
        path = Some(s)
        MemberName
      case _ => throw new IllegalStateException
    }

  def trueValue() =
    throw new IllegalStateException

  def falseValue() =
    throw new IllegalStateException

  def nullValue() =
    throw new IllegalStateException

  def error(message: String, line: Int, pos: Int, excerpt: String) =
    throw new JsonParseException(message, line, pos, "")
}
