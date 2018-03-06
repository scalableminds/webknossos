# Data cleanup

## on disk (json files)

* [DONE] remove dataset resolution duplicates  597c801da10a484c87199a1b 2012-09-28_ex145_07x2_ROI2016_vessel  and  597c801da10a484c87199a46 2016-06-02-FD0144_2_Confocal_2

## in mongo (directly before migration)

* [DONE] set team of CajalCourse annotations to Connectomics department
["59ca1a405f00002f1a988e85", "59db894b2f00009b6fbde3d4", "59db8a9e2f0000b36fbde626", "59db94a52f00009271c0a2d3", "59db95052f00003571c0a3b9", "59dba4602f00002674c27a04", "59dba4612f00002674c27a06", "59dba4642f00001b74c27a0a", "59dba46c2f00002574c27a10", "59dba48c2f00002674c27a2d", "59dc7b702f00001284c7e000", "59dc836b2f0000c185c7f175", "59dc946b2f0000f887c80b12", "59dc947b2f00000388c80bc5", "59dc94a22f0000c687c80cb4", "59dc96452f00000988c8166e", "59dcb6aa2f00007088c943a7", "59dcba7e2f0000c888c958e8", "59dcbb2a2f00007b88c96258", "59dcccfd2f0000ac89ca0de8", "59dcd1012f0000f389ca7317", "59dcd1d42f0000ed89ca7a3a", "59dce0382f0000368bcb1d80", "59dce0792f0000268bcb1db8", "59dce5f82f0000188ccb274d", "59dce8de2f0000728ccb3140", "59dcef452f0000ca8ccb6a27", "59e090d12f0000b5bc87809e", "59e0915c2f0000bdbc885a1e"]



* insert dummy projects (isActive: false)

"AG_P14_L4_AG_ApicalAxDendrites"
"AM_Astrocyte_Connections_ex145_07x2_ROI2017_1"
"BS_L4_wholeCell_mergeMode"
"CS_MB_L4_axEndQuerySpecial_12_09_2017"
"CSMB_AxonLeftQueries"
"CSMB_AxonLeftQueriesTest"
"DalilaTest"
"FD_0144-2_v2s2_Correlative_Dataset_LR_Apical_Tracing"
"focus_flight_test_11_09_2017"
"L4_chiasma_axon_queries_09_11_2017"
"L4_focus_flight-new-1"
"Oxalis Training"
"PB_st0004_mergerModehei_Fig1PanelC_8_11_2017"
"PL_YH_st126_MT3_VIPcells_2"
"Test_Dalila_axon"
"TestDalila"
"TestProjectDalila"
"TestProjectDalila1"
"TestProjectDalila2"
"TestProjectDalila3"
"TestProjectHeikoMT"
"testtest3"


* insert dummy datasets (isActive: false)




## in Postgres

### analytics
* `DELETE FROM webknossos.analytics WHERE _user NOT IN (SELECT _id FROM webknossos.users) AND _user IS NOT NULL;` (1 row, 1 user)

### annotations

* `UPDATE webknossos.annotations SET _task = NULL, typ = 'Orphan' WHERE _id IN (SELECT a._id FROM webknossos.annotations a LEFT OUTER JOIN webknossos.tasks t ON a._task = t._id WHERE t._id IS NULL AND a._task IS NOT NULL);` (takes 20-30s, 193488 rows)
* `UPDATE webknossos.annotations SET _user = '594bb2eb640000c8bd22f6bc' WHERE _user NOT IN (SELECT _id FROM webknossos.users);` (4862 rows, 133 users) (new id: Deleted User, already created in mongo)

### timespans
* `DELETE FROM webknossos.timespans WHERE _user NOT IN (SELECT _id FROM webknossos.users);` (9432 rows, 109 users)
* `UPDATE webknossos.timespans SET _annotation = NULL WHERE _id IN (SELECT t._id FROM webknossos.timespans t LEFT OUTER JOIN webknossos.annotations a ON t._annotation = a._id WHERE a._id IS NULL AND t._annotation IS NOT NULL);` (4308 rows)
