success=0
max=100

# iterate over test-suite
for i in `seq $max`
do
  echo "Test-suite iteration #$i"
  npm run protractor
  if [ $? == 0 ]; then
    success=$(( $success + 1 ))
  fi
done

# print results
echo "$success/$max tests were successful!"
