package com.scalableminds.util.tools

import scala.util.Try
import scala.util.Success

// Define Failure case class
case class Failure(msg: String)

case class Empty()

object Empty{}

class Box[A](val box: Success[A] | Empty | Failure) {

    def get: A = box match {
        case Success(value) => value
        case _ => throw new Exception("Box is empty")
    }

    def isSuccess: Boolean = box match {
        case Success(_) => true
        case _ => false
    }

    def isFailure: Boolean = box match {
        case Failure(_) => true
        case _ => false
    }

    def isEmpty: Boolean = box match {
        case Empty() => true
        case _ => false
    }

    def getOrElse[B >: A](default: => B): B = box match {
        case Success(value) => value
        case _ => default
    }

    def map[B](f: A => B): Box[B] = box match {
        case Success(value) => new Box(Success(f(value)))
        case Failure(msg) => new Box(Failure(msg))
        case Empty() => new Box(Empty())
    }

    def flatMap[B](f: A => Box[B]): Box[B] = box match {
        case Success(value) => f(value)
        case Failure(msg) => new Box(Failure(msg))
        case Empty() => new Box(Empty())
    }

    def filter(p: A => Boolean): Box[A] = box match {
        case Success(value) if p(value) => this
        case Success(_) => new Box(Failure("Predicate does not hold for value"))
        case Failure(msg) => new Box(Failure(msg))
        case Empty() => new Box(Empty())
    }

    def foreach(f: A => Unit): Unit = box match {
        case Success(value) => f(value)
        case _ => ()
    }

    def toOption: Option[A] = box match {
        case Success(value) => Some(value)
        case _ => None
    }

    def toTry: Try[A] = box match {
        case Success(value) => Success(value)
        case Failure(msg) => scala.util.Failure(new Exception(msg))
        case _ => scala.util.Failure(new Exception("Box is empty"))
    }
}
