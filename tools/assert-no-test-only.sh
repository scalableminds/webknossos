#!/bin/bash
exit_code=0
echo "Checking for test.only() in test files."
! grep -r "test\.only(" frontend/javascripts/test || { echo "Found test files with test.only() which disables other tests. Please remove the only modifier."; exit_code=1; }
! grep -r "test\.serial\.only(" frontend/javascripts/test || { echo "Found test files with test.only() which disables other tests. Please remove the only modifier."; exit_code=1; }
echo "Done"
exit $exit_code
