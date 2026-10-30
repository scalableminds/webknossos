// javac -d /tmp/wk-jpeg-oracle backend-rust/tools/GenerateJpegFixtures.java
// java -cp /tmp/wk-jpeg-oracle GenerateJpegFixtures backend-rust/datastore/tests/fixtures/precomputed
import java.awt.image.*;
import javax.imageio.*;
import javax.imageio.stream.*;
import java.nio.file.*;
import java.util.Iterator;
public class GenerateJpegFixtures {
  public static void main(String[] args) throws Exception {
    Path root=Path.of(args[0]); Files.createDirectories(root);
    for (boolean gray: new boolean[]{true,false}) for(boolean progressive:new boolean[]{false,true}) {
      String name=(gray?"gray":"bgr")+(progressive?"_progressive":"_baseline");
      BufferedImage image=new BufferedImage(16,32,gray?BufferedImage.TYPE_BYTE_GRAY:BufferedImage.TYPE_3BYTE_BGR);
      byte[] bytes=((DataBufferByte)image.getRaster().getDataBuffer()).getData();
      for(int i=0;i<bytes.length;i++) bytes[i]=(byte)((i*31+i/7*13)%256);
      Iterator<ImageWriter> writers=ImageIO.getImageWritersByFormatName("jpeg"); ImageWriter writer=writers.next();
      ImageWriteParam parameters=writer.getDefaultWriteParam();parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);parameters.setCompressionQuality(0.85f);
      parameters.setProgressiveMode(progressive?ImageWriteParam.MODE_DEFAULT:ImageWriteParam.MODE_DISABLED);
      try(ImageOutputStream os=ImageIO.createImageOutputStream(root.resolve(name+".jpeg").toFile())) {
        writer.setOutput(os);writer.write(null,new IIOImage(image,null,null),parameters);
      } writer.dispose();
      BufferedImage decoded=ImageIO.read(root.resolve(name+".jpeg").toFile());
      Files.write(root.resolve(name+".decoded"),((DataBufferByte)decoded.getRaster().getDataBuffer()).getData());
    }
  }
}
