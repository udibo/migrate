
start:
	sudo docker-compose up -d postgres

stop:
	sudo docker-compose down

restart: stop start

check:
	deno lint
	deno fmt --check

test:
	deno test -A ${DENO_ARGS}

test-watch:
	make test DENO_ARGS="--watch ${DENO_ARGS}"

test-coverage:
	make test DENO_ARGS="--coverage=cov ${DENO_ARGS}"
	deno coverage cov --exclude=file:///tmp/.*
	rm -rf cov

test-build:
	sudo docker-compose build test
	sudo docker-compose run test
