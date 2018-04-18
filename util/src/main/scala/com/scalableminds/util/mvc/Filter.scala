/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.mvc

import com.scalableminds.util.tools.Converter
import play.api.mvc.Request

case class Filter[A, T](name: String, predicate: (A, T) => Boolean)(implicit converter: Converter[String, A]) {
  def applyOn(list: List[T])(implicit request: Request[_]): List[T] = {
    request.getQueryString(name).flatMap(converter.convert) match {
      case Some(attr) => list.filter(predicate(attr, _))
      case _ => list
    }
  }
}

case class FilterColl[T](filters: Seq[Filter[_, T]]) {
  def applyOn(list: List[T])(implicit request: Request[_]): List[T] = {
    filters.foldLeft(list) {
      case (l, filter) => filter.applyOn(l)
    }
  }

  def apply[R](block: FilterColl[T] => R): R = {
    block(this)
  }
}

trait WithFilters{
  def UsingFilters[T](filters: Filter[_, T]*): FilterColl[T] =
    FilterColl(filters)
}

