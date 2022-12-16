#!/bin/bash
echo "Checking for test.only() in test files."
! grep -r "test\.only(" frontend/javascripts/test || echo "Found test files with test.only() which disables other tests. Please remove the only modifier."
echo "Done"
