package com.scalableminds.util.xml;

import org.codehaus.stax2.io.EscapingWriterFactory;

import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;

public class MyEscapingWriterFactory implements EscapingWriterFactory {

  public Writer createEscapingWriterFor(Writer w, String enc) {
    return new MyEscapingWriter(w);
  }

  public Writer createEscapingWriterFor(OutputStream out, String enc) {
    return new MyEscapingWriter(new OutputStreamWriter(out));
  }

}
