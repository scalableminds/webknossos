// Fixture oracle only. The Rust datastore does not link this C++ code.
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
#include "compresso.hpp"
int main(int argc,char **argv) {
    if(argc!=3)return 1;
    std::ifstream input(argv[1],std::ios::binary);
    std::vector<unsigned char> encoded((std::istreambuf_iterator<char>(input)),{});
    if(encoded.size()<36)return 2;
    auto h=compresso::CompressoHeader::fromchars(encoded.data());
    size_t length=size_t(h.sx)*h.sy*h.sz*h.data_width;
    if(length==0 || length>300*1024*1024)return 3;
    std::vector<unsigned char> output(length);
    int result=compresso::decompress<void,void>(encoded.data(),encoded.size(),output.data());
    if(result!=0){std::cerr<<"Native error "<<result<<"\n";return 4;}
    std::ofstream file(argv[2],std::ios::binary);file.write(reinterpret_cast<char*>(output.data()),output.size());
    return file?0:5;
}
