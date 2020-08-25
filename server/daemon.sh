#!/bin/bash

while :
do
	export NODE_ENV=production
	node index.js
	sleep 1
done

