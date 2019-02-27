package com.scalableminds.util.mvc

import com.scalableminds.util.tools.{Converter, Fox}
import play.api.mvc.Request

import scala.concurrent.ExecutionContext

case class Filter[A, T](name: String, predicate: (A, T) => Fox[Boolean], default: Option[String] = None)(
    implicit converter: Converter[String, A]) {
  def applyOn(list: List[T])(implicit request: Request[_], ec: ExecutionContext): Fox[List[T]] =
    request.getQueryString(name).orElse(default).flatMap(converter.convert) match {
      case Some(attr) => Fox.filter(list)(predicate(attr, _))
      case _          => Fox.successful(list)
    }
}

case class FilterColl[T](filters: Seq[Filter[_, T]]) {
  def applyOn(list: List[T])(implicit request: Request[_], ec: ExecutionContext): Fox[List[T]] =
    filters.foldLeft(Fox.successful(list)) {
      case (l, filter) => l.flatMap(filter.applyOn(_))
    }
}

trait WithFilters {
  def UsingFilters[T, R](filters: Filter[_, T]*)(block: FilterColl[T] => R)(implicit ec: ExecutionContext): R =
    block(FilterColl(filters))
}
