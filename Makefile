
run: docker
#	docker run --platform linux/amd64 -it --rm -v $$(pwd):$$(pwd) -w $$(pwd) 
	docker run --platform linux/amd64 -it --rm -v $$(pwd):$$(pwd) -w $$(pwd) frame --service-account $$(pwd)/KEY.json --google-calendar zerojinx@gmail.com --google-calendar josiefp@gmail.com --calendar https://p53-caldav.icloud.com/published/2/Mjc4NjIyMTgyMjc4NjIyMezQsgpALDLLkK1xb_N3U8wB68OebNG3Il_Mmnp2eGC9710fOCsloLUJMAGliZo9ZIitwiU3xG8_IpZaR22aHo0 --calendar https://calendar.google.com/calendar/ical/c_b9f7b2e9d4c869a99ed9a6dfa4d4f86d1b91a96bade8b1a1890743b1ebbef8bd%40group.calendar.google.com/public/basic.ics --calendar https://www.onlinescoutmanager.co.uk/ext/cal/?f=238216.M2M0MmFmNWZlZTcxYjNmNWJmYjdjODg5M2FjOTI1MTYzNWY2N2IzYWEzYzQzYWRjMjc4NWU2ZjNjMWUzYmRjZjkwYmI5ZjZmYzZkZTdhM2I3ODFmYzg2N2VhM2Q0Yjc0ZGI2N2VjZDhmNDU3NzZmOTIzY2I4MjZjZmZlNGY1YzM%3D.xxcVjBckWK

docker:
	docker build --platform linux/amd64 -t frame .

jpg2inky:
	node --experimental-sea-config sea-config.json
	cp $$(command -v node) jpg2inky
	npx postject jpg2inky NODE_SEA_BLOB jpg2inky.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 
