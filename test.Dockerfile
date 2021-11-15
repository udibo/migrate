FROM denoland/deno:1.16.1
WORKDIR /app

# Install wait utility
USER root
ADD https://github.com/ufoscout/docker-compose-wait/releases/download/2.8.0/wait /wait
RUN chmod +x /wait

USER deno

# Cache external dependencies
COPY deps.ts .
RUN deno cache deps.ts
COPY test_deps.ts .
RUN deno cache test_deps.ts

ADD . .
# Compile the postgres entry point
RUN deno cache postgres.ts

RUN deno lint
RUN deno fmt --check

CMD /wait && deno test -A
