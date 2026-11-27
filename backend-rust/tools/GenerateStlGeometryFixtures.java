import java.nio.file.*;
import java.util.*;
import com.scalableminds.webknossos.datastore.services.mesh.FullMeshHelper;
import com.typesafe.scalalogging.Logger;
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes;
import com.scalableminds.util.geometry.*;
import scala.collection.mutable.ArrayBuffer;
import java.nio.*;
public class GenerateStlGeometryFixtures {
    static class Helper implements FullMeshHelper {public Logger logger(){return null;}}
    static float[] volume(int n,int[][] positions,Vec3Float offset,Vec3Float scale) {
        var data=new int[n*n*n];for(var p:positions)data[p[0]+n*(p[1]+n*p[2])]=17;
        var buffer=new ArrayBuffer<Object>();var dims=new Vec3Int(n,n,n);
        for(int x=0;x<n;x+=32)for(int y=0;y<n;y+=32)for(int z=0;z<n;z+=32)
            MarchingCubes.marchingCubes(data,dims,new BoundingBox(new Vec3Int(x,y,z),Math.min(n-x,33),Math.min(n-y,33),Math.min(n-z,33)),17,offset,scale,buffer);
        var output=new float[buffer.size()];for(int i=0;i<output.length;i++)output[i]=(Float)buffer.apply(i);return output;
    }
    static byte[] floats(float[] values) {var b=ByteBuffer.allocate(values.length*4).order(ByteOrder.LITTLE_ENDIAN);for(float f:values)b.putFloat(f);return b.array();}
    public static void main(String[] args)throws Exception {
        var helper=new Helper();var root=Path.of(args[0]);
        float[] vertices={0,0,0,1,0,0,0,1,0,2,3,4,7,3,4,2,9,4};
        Files.write(root.resolve("adhoc.stlraw"),helper.adHocMeshToStl(vertices));
        var cubes=ByteBuffer.allocate(256*15*3*4+256*4).order(ByteOrder.LITTLE_ENDIAN);
        for(int cube=0;cube<256;cube++) {
            var data=new int[8];int[] corners={0,1,3,2,4,5,7,6};
            for(int bit=0;bit<8;bit++)if((cube & (1<<bit))!=0)data[corners[bit]]=17;
            var buffer=new ArrayBuffer<Object>();
            MarchingCubes.marchingCubes(data,new Vec3Int(2,2,2),new BoundingBox(new Vec3Int(0,0,0),2,2,2),17,new Vec3Float(10.25f,-20.5f,.125f),new Vec3Float(2.5f,.75f,4f),buffer);
            cubes.putInt(buffer.size());for(int i=0;i<buffer.size();i++)cubes.putFloat((Float)buffer.apply(i));
        }
        Files.write(root.resolve("cubes.bin"),Arrays.copyOf(cubes.array(),cubes.position()));
        // Tile order and boundary overlap: a narrow object crosses all three 32-cell planes.
        int n=35; var data=new int[n*n*n];
        for(int z=30;z<34;z++)for(int y=31;y<34;y++)for(int x=30;x<34;x++)data[x+n*(y+n*z)]=17;
        var buffer=new ArrayBuffer<Object>();
        var dims=new Vec3Int(n,n,n);
        for(int x=0;x<n;x+=32)for(int y=0;y<n;y+=32)for(int z=0;z<n;z+=32)
            MarchingCubes.marchingCubes(data,dims,new BoundingBox(new Vec3Int(x,y,z),Math.min(n-x,33),Math.min(n-y,33),Math.min(n-z,33)),17,new Vec3Float(10.25f,-20.5f,.125f),new Vec3Float(2.5f,.75f,4f),buffer);
        var tiled=ByteBuffer.allocate(buffer.size()*4).order(ByteOrder.LITTLE_ENDIAN);
        for(int i=0;i<buffer.size();i++)tiled.putFloat((Float)buffer.apply(i));
        Files.write(root.resolve("tiled.bin"),tiled.array());
        var unit=new Vec3Float(1,1,1);var zero=new Vec3Float(0,0,0);
        Files.write(root.resolve("route_cube.bin"),floats(volume(2,new int[][]{{0,0,0}},zero,new Vec3Float(2.5f,.75f,4))));
        Files.write(root.resolve("indexed.stlraw"),helper.adHocMeshToStl(volume(33,new int[][]{{0,0,0}},zero,unit)));
        var first=helper.adHocMeshToStl(volume(129,new int[][]{{127,4,5},{128,4,5}},zero,unit));
        var second=helper.adHocMeshToStl(volume(129,new int[][]{{0,4,5}},new Vec3Float(128,0,0),unit));
        var wave=new byte[second.length+first.length];System.arraycopy(second,0,wave,0,second.length);System.arraycopy(first,0,wave,second.length,first.length);
        Files.write(root.resolve("bfs.stlraw"),wave);
        var paths=Files.list(root).filter(p->p.toString().endsWith(".stlraw")).sorted().toList();
        var fields=new ArrayList<String>();
        var playFields=new ArrayList<String>();
        for(var path:paths)fields.add("\""+path.getFileName()+"\":"+helper.surfaceAreaFromRawChunkStlBytes(Files.readAllBytes(path)));
        for(var path:paths)playFields.add("\""+path.getFileName()+"\":"+play.api.libs.json.Writes$.MODULE$.FloatWrites().writes(helper.surfaceAreaFromRawChunkStlBytes(Files.readAllBytes(path))));
        Files.writeString(root.resolve("areas.json"),"{"+String.join(",",fields)+"}\n");
        Files.writeString(root.resolve("areas_play.json"),"{"+String.join(",",playFields)+"}\n");

    }
}
