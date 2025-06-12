
run: docker
	docker run --platform linux/amd64 -it --rm -v $$(pwd):$$(pwd) -w $$(pwd) frame perl ical2png --calendar "https://calendar.google.com/calendar/u/6?cid=Y19iOWY3YjJlOWQ0Yzg2OWE5OWVkOWE2ZGZhNGQ0Zjg2ZDFiOTFhOTZiYWRlOGIxYTE4OTA3NDNiMWViYmVmOGJkQGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20" --calendar "https://calendar.google.com/calendar/u/0?cid=emVyb2ppbnhAZ21haWwuY29t" --view week --output weekly.png

docker:
	docker build --platform linux/amd64 -t frame .

jpg2inky:
	node --experimental-sea-config sea-config.json
	cp $$(command -v node) jpg2inky
	npx postject jpg2inky NODE_SEA_BLOB jpg2inky.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 
