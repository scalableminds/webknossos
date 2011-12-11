package com.scalableminds.brainflight;

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/14/11
 * Time: 5:56 AM
 */

import org.eclipse.jetty.util.log.Logger;

/**
 *  Grabs Jetty's log messages and doesn't care about them
 */
public class JavaSilentLogger implements Logger{

    public void debug(Throwable arg0) {
    }

    public void debug(String arg0, Object... arg1) {
    }

    public void debug(String arg0, Throwable arg1) {
    }

    public Logger getLogger(String arg0) {
        return this;
    }

    public String getName() {
        return "JavaSilentLogger";
    }

    public void ignore(Throwable arg0) {
    }

    public void info(Throwable arg0) {
    }

    public void info(String arg0, Object... arg1) {
    }

    public void info(String arg0, Throwable arg1) {
    }

    public boolean isDebugEnabled() {
        return false;
    }

    public void setDebugEnabled(boolean arg0) {
    }

    public void warn(Throwable arg0) {
    }

    public void warn(String arg0, Object... arg1) {
    }

    public void warn(String arg0, Throwable arg1) {
    }
}