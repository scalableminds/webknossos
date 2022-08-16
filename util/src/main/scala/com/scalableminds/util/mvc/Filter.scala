package com.scalableminds.util.mvc

import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

case class Filter[A, T](attributeValue: Option[A], predicate: (A, T) => Fox[Boolean]) {
  def applyOn(list: List[T])(implicit ec: ExecutionContext): Fox[List[T]] =
    attributeValue.map { v: A =>
      Fox.filter(list)(predicate(v, _))
    }.getOrElse(Fox.successful(list))
}

case class FilterColl[T](filters: Seq[Filter[_, T]]) {
  def applyOn(list: List[T])(implicit ec: ExecutionContext): Fox[List[T]] =
    filters.foldLeft(Fox.successful(list)) {
      case (l, filter) => l.flatMap(filter.applyOn(_))
    }
}

trait WithFilters {
  def UsingFilters[T, R](filters: Filter[_, T]*)(block: FilterColl[T] => R): R =
    block(FilterColl(filters))
}
