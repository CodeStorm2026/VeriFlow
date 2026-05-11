#!/usr/bin/env bash
set -e

docker compose exec kafka kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic vf.events --partitions 3 --replication-factor 1
docker compose exec kafka kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic vf.control --partitions 1 --replication-factor 1
