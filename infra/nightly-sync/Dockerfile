FROM postgres:16-alpine

COPY scripts/operations/sync-production-to-staging.sh /usr/local/bin/sync-production-to-staging
RUN chmod 0755 /usr/local/bin/sync-production-to-staging

ENTRYPOINT ["/usr/local/bin/sync-production-to-staging"]
