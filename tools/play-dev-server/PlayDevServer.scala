import play.core.BuildLink
import play.core.server.DevServerStart

import java.io.File
import java.lang.management.ManagementFactory
import java.nio.file.Paths
import java.util.concurrent.atomic.AtomicBoolean
import scala.sys.process.*

/** Starts webknossos in Play dev mode, without sbt. Usage: `./mill -w dev.runBackground <port>`
  *
  * Play's own dev mode reloads changed classes on the next request. Here, Mill instead restarts this whole process when
  * sources change, so the BuildLink hands out the application classloader once and never reloads.
  */
object PlayDevServer {
  def main(args: Array[String]): Unit = {
    startDebugAgent()
    val port = args.headOption.map(_.toInt).getOrElse(9000)
    val classesLoaded = new AtomicBoolean(false)
    val buildLink = new BuildLink {
      override def reload(): AnyRef =
        if (classesLoaded.compareAndSet(false, true)) getClass.getClassLoader else null
      override def findSource(className: String, line: Integer): Array[AnyRef] = null
      override def projectPath(): File = new File(".").getAbsoluteFile
      override def forceReload(): Unit = ()
      override def settings(): java.util.Map[String, String] = java.util.Map.of()
    }
    DevServerStart.mainDevHttpMode(buildLink, port, "0.0.0.0")
    ()
  }

  /** Mill starts the new process of a restart while the previous one still runs, and only calls main once that one is
    * gone. A debug agent listening from JVM start would fail to bind the port, so it is configured with onjcmd=y (see
    * build.mill) and started here instead.
    */
  private def startDebugAgent(): Unit =
    if (ManagementFactory.getRuntimeMXBean.getInputArguments.stream().anyMatch(_.contains("onjcmd=y"))) {
      val jcmd = Paths.get(System.getProperty("java.home"), "bin", "jcmd").toString
      Seq(jcmd, ProcessHandle.current().pid().toString, "VM.start_java_debugging").!
      ()
    }
}
