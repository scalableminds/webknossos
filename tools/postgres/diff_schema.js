#!/usr/bin/env node
var program = require('commander');
var randomstring = require("randomstring");
const execSync = require('child_process').execSync;
var path = require('path');
var fs = require('fs');
var glob = require("glob")
var tmp = require('tmp');
var rimraf = require('rimraf');

let POSTGRES_URL = process.env.POSTGRES_URL
let ORIGINAL_POSTGRES_URL = (typeof POSTGRES_URL !== 'undefined') ? POSTGRES_URL:"jdbc:postgresql://localhost/webknossos"
const scriptdir = __dirname
const scriptName = __filename

function dump(parameter) {
	var cleanUp = function(){};
	if(parameter == "DB") { 
		POSTGRES_URL=ORIGINAL_POSTGRES_URL // this environment variable is passed to dump_schema.sh
	} else {
		const tempDbName = generateRandomName()
		const postgresDirname = path.dirname(ORIGINAL_POSTGRES_URL)
		POSTGRES_URL= `${postgresDirname}/${tempDbName}`;
		const dbName = execSync(scriptdir+'/db_name.sh', {env: {'POSTGRES_URL': POSTGRES_URL}}).toString().trim() // "trim" to remove the line break
		if(dbName !== tempDbName) {
			console.log("Wrong dbName")	
			process.exit(1)
		}
		console.log("Creating DB " + dbName)
		const dbHost = execSync(scriptdir+'/db_host.sh', {env: {'POSTGRES_URL': POSTGRES_URL}}).toString().trim()
		execSync(`psql -U postgres -h ${dbHost} -c "CREATE DATABASE ${dbName};"`, {env: {'PGPASSWORD': 'postgres'}})
		var fileNames = glob.sync(parameter)
		const concatenateFileNames = fileNames.map(name => "-f " + name).join(' ')
		execSync(`psql -U postgres -h ${dbHost} --dbname="${dbName}" -v ON_ERROR_STOP=ON -q ${concatenateFileNames}`, {env: {'PGPASSWORD': 'postgres'}})
		cleanUp = function(){
			console.log(`CLEANUP: DROP DATABASE ${dbName}`)
			execSync(`psql -U postgres -h ${dbHost} -c \"DROP DATABASE ${dbName};\"`, {env: {'PGPASSWORD': 'postgres'}})
		}
	}
	var tmpDir = tmp.dirSync();
	try {
		execSync(`${scriptdir}/dump_schema.sh ${tmpDir.name}`, {env: {'POSTGRES_URL': POSTGRES_URL}})
	} catch(err) {
		console.log(`CLEANUP: remove ${tmpDir.name}`)
		rimraf.sync(tmpDir.name)
		process.exit(1)
	}
	cleanUp();
	return tmpDir.name
}

function generateRandomName(){
	random = randomstring.generate({
  				length: 8,
  				charset: 'alphanumeric',
  				capitalization: 'lowercase'
			})
	return 'wk_tmp_' + random
}

process.on('exit', function(code) {
    if (dir1) {
    	console.log(`CLEANUP: remove ${dir1}`);
    	rimraf.sync(dir1)
    }
    if (dir2){
    	console.log(`CLEANUP: remove ${dir2}`);
    	rimraf.sync(dir2)
    }
});

program
  .version('0.1.0', '-v, --version')
  .arguments('<parameter1> <parameter2>')
  .action(function (parameter1, parameter2) {
     p1 = parameter1;
     p2 = parameter2;
  });

if(process.argv.length != 4) { // 2 "real" parameter
	console.log("Usage: $0 <sqlFiles|DB> <sqlFiles|DB>");
  	console.log("Examples:")
  	console.log("  node ", scriptName, " tools/postgres/schema.sql \"conf/evolutions/*.sql\"")
  	console.log("  node ", scriptName, " tools/postgres/schema.sql DB")
	process.exit()
}

program.parse(process.argv)
const dir1 = dump(p1);
const dir2 = dump(p2);
// sort and remove commas
execSync(`find ${dir1} -type f -exec sed -i 's/,$//' {} +`)
execSync(`find ${dir1} -type f -exec sort -o {} {} \\;`)
execSync(`find ${dir2} -type f -exec sed -i 's/,$//' {} +`)
execSync(`find ${dir2} -type f -exec sort -o {} {} \\;`)
// diff
try{
	execSync(`diff -r ${dir1} ${dir2}`, {stdio:[0,1,2]}) // we pass the std-output to the child process to see the diff
	console.log("[SUCCESS] Schemas do match")
} catch(err) { // execSync throws an ugly error if a child-process fails
	console.log("[FAILED] Schemas do not match")
}
