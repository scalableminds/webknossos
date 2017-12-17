# Data cleanup

## in MongoDB
### tasks
* Update `{"neededExperience.domain": ""}` to `{"neededExperience.domain": "null"}`
* Recreate projects
  - AG_P14_L4_AG_ApicalAxDendrites
  - AM_Astrocyte_Connections_ex145_07x2_ROI2017_1
  - BS_L4_wholeCell_mergeMode
  - CSMB_AxonLeftQueries
  - CSMB_AxonLeftQueriesTest
  - CS_MB_L4_axEndQuerySpecial_12_09_2017
  - FD_0144-2_v2s2_Correlative_Dataset_LR_Apical_Tracing
  - L4_chiasma_axon_queries_07_11_2017
  - L4_chiasma_axon_queries_09_11_2017
  - L4_focus_flight-new-1
  - PB_st0004_mergerModehei_Fig1PanelC_8_11_2017
  - PL_YH_st126_MT3_VIPcells_2
  - TestDalila
  - TestProjectDalila
  - Test_Dalila_axon
  - testtest3
  - Oxalis Training

### teams
* Set a default owner, e.g. `5447d5902d00001c35e1c965` hwissler

### dataSets
* Remove duplicate `{"dataSource.id.name":"seq_3945-4344_003r6_aligned","isActive":false}`
* Remove duplicate `{"dataSource.id.name":"151210_FM0004","isActive":false}`

### taskTypes
* Remove duplicate `{"summary":"synapse_to_axon","isActive":false}`

### users
* Update `{"teams.role.name":""}` to `{"teams":[{"team":"turtlecortex", "role": { "name":"user" }}]}`

## in Postgres

### analytics
* `DELETE FROM analytics WHERE _user NOT IN (SELECT _id FROM users) AND _user IS NOT NULL`

### annotations
* `UPDATE annotations SET _task = NULL, typ = 'Orphan' WHERE _id IN (SELECT a._id FROM annotations a LEFT OUTER JOIN tasks t ON a._task = t._id WHERE t._id IS NULL AND a._task IS NOT NULL);`
* `UPDATE annotations SET _user = 'DEFAULT_USERDEFAULT_USER' WHERE _user NOT IN (SELECT _id FROM users);` (4862 rows, 133 users)

### tasks
* `UPDATE tasks SET _script = '59947ae85e0000470129c899' WHERE _script = '59947ae85e0000470129c8  ';`

### teams
* `UPDATE teams SET _owner = '5447d5902d00001c35e1c965' WHERE _owner NOT IN (SELECT _id FROM users);`

### timespans
* `DELETE FROM timespans WHERE _user NOT IN (SELECT _id FROM users);`
* `UPDATE timespans SET _annotation = NULL WHERE _id IN (SELECT t._id FROM timespans t LEFT OUTER JOIN annotations a ON t._annotation = a._id WHERE a._id IS NULL AND t._annotation IS NOT NULL);`


