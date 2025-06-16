
run: docker
#	docker run --platform linux/amd64 -it --rm -v $$(pwd):$$(pwd) -w $$(pwd) 
	docker run --platform linux/amd64 -it --rm -v $$(pwd):$$(pwd) -w $$(pwd) frame --dark --calendar https://calendars.icloud.com/holidays/gb_en-gb.ics/ --view month

docker:
	docker build --platform linux/amd64 -t frame .

#jpg2inky:
#	node --experimental-sea-config sea-config.json
#	cp $$(command -v node) jpg2inky
#	npx postject jpg2inky NODE_SEA_BLOB jpg2inky.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 

