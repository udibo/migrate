test:
	sudo docker-compose up -d postgres
	deno test -A ${DENO_ARGS}

test-watch:
	make test DENO_ARGS="--watch ${DENO_ARGS}"

test-coverage:
	make test DENO_ARGS="--coverage=cov"
	deno coverage cov --exclude=file:///tmp/.*
	rm -rf cov

cleanup:
	sudo docker-compose down
