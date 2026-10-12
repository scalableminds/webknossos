/* Oracle only: the datastore runtime never links libhdf5. */
#include <hdf5.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc,char **argv) {
    if(argc!=2)return 1;
    hid_t file=H5Fopen(argv[1],H5F_ACC_RDONLY,H5P_DEFAULT);
    if(file<0)return 2;
    puts("[");int first=1;
    for(int width=1;width<=8;width*=2)for(int sign=0;sign<2;sign++) {
        char name[32];snprintf(name,sizeof(name),"%s_%d",sign?"signed":"unsigned",width);
        hid_t dataset=H5Dopen2(file,name,H5P_DEFAULT),space=H5Dget_space(dataset);
        size_t count=(size_t)H5Sget_simple_extent_npoints(space);
        uint64_t *values=calloc(count,sizeof(uint64_t));
        if(H5Dread(dataset,H5T_NATIVE_UINT64,H5S_ALL,H5S_ALL,H5P_DEFAULT,values)<0)return 3;
        if(!first)puts(",");first=0;
        printf("{\"name\":\"%s\",\"values\":[",name);
        for(size_t i=0;i<count;i++)printf("%s\"%" PRIu64 "\"",i?",":"",values[i]);
        printf("]}");free(values);H5Sclose(space);H5Dclose(dataset);
    }
    for(int width=4;width<=8;width*=2) {
        char name[32];snprintf(name,sizeof(name),"float%d",width*8);
        hid_t dataset=H5Dopen2(file,name,H5P_DEFAULT),space=H5Dget_space(dataset);
        size_t count=(size_t)H5Sget_simple_extent_npoints(space);
        float *values=calloc(count,sizeof(float));
        if(H5Dread(dataset,H5T_NATIVE_FLOAT,H5S_ALL,H5S_ALL,H5P_DEFAULT,values)<0)return 4;
        printf(",\n{\"name\":\"%s\",\"values\":[",name);
        for(size_t i=0;i<count;i++)printf("%s%.9g",i?",":"",values[i]);
        printf("]}");free(values);H5Sclose(space);H5Dclose(dataset);
    }
    puts("\n]");H5Fclose(file);return 0;
}
