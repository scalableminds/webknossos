// Golden input encoder only; datastore runtime never links C++ Draco.
#include <draco/compression/encode.h>
#include <draco/mesh/mesh.h>
#include <fstream>
#include <string>
#include <array>
int main(int argc,char **argv) {
    if(argc!=2)return 1;
    for(bool integer:{false,true})for(int method:{draco::MESH_SEQUENTIAL_ENCODING,draco::MESH_EDGEBREAKER_ENCODING}) {
        draco::Mesh mesh;mesh.set_num_points(4);mesh.SetNumFaces(2);
        mesh.SetFace(draco::FaceIndex(0),{{draco::PointIndex(0),draco::PointIndex(1),draco::PointIndex(2)}});
        mesh.SetFace(draco::FaceIndex(1),{{draco::PointIndex(1),draco::PointIndex(3),draco::PointIndex(2)}});
        draco::GeometryAttribute attr;
        attr.Init(draco::GeometryAttribute::POSITION,nullptr,3,integer?draco::DT_UINT32:draco::DT_FLOAT32,false,12,0);
        int id=mesh.AddAttribute(attr,true,4);
        float floats[4][3]={{.1f,.2f,.3f},{1.25f,-2.5f,3.5f},{4.25f,5.5f,-6.5f},{7.5f,-8.75f,9.125f}};
        uint32_t ints[4][3]={{0,0,0},{1023,0,0},{0,1023,0},{0,0,1023}};
        for(int i=0;i<4;i++)mesh.attribute(id)->SetAttributeValue(draco::AttributeValueIndex(i),integer?(const void*)ints[i]:(const void*)floats[i]);
        draco::Encoder encoder;encoder.SetEncodingMethod(method);encoder.SetSpeedOptions(0,0);
        if(!integer)encoder.SetAttributeQuantization(draco::GeometryAttribute::POSITION,14);
        draco::EncoderBuffer buffer;auto status=encoder.EncodeMeshToBuffer(mesh,&buffer);
        if(!status.ok())return 2;
        std::string name=(integer?"integer":"float")+std::string(method==draco::MESH_SEQUENTIAL_ENCODING?"_sequential":"_edgebreaker");
        std::ofstream output(std::string(argv[1])+"/"+name+".drc",std::ios::binary);output.write(buffer.data(),buffer.size());
    }
    return 0;
}
