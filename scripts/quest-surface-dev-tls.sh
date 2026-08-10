#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 OUTPUT_DIR SERVER_DNS_NAME SERVER_IP" >&2
  exit 2
}

[[ $# -eq 3 ]] || usage
command -v openssl >/dev/null 2>&1 || {
  echo "error: openssl is required" >&2
  exit 2
}

readonly SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly REPO_ROOT=$(realpath -e "${SCRIPT_DIR}/..")
readonly OUTPUT_DIR=$(realpath -m "$1")
readonly SERVER_DNS_NAME=$2
readonly SERVER_IP=$3
# Android's PKCS12 KeyStore rejects an empty password before TLS begins. This
# fixed development compatibility value is compiled into the test client and
# is not a security boundary; the packaged disposable identity remains secret
# material regardless of the container password.
readonly CLIENT_IDENTITY_PASSWORD=soma-quest-v1a-dev

case "$OUTPUT_DIR" in
  "$REPO_ROOT"|"$REPO_ROOT"/*)
    echo "error: TLS identities must stay outside the Soma repository" >&2
    exit 2
    ;;
esac
[[ "$SERVER_DNS_NAME" =~ ^[A-Za-z0-9.-]+$ ]] || {
  echo "error: SERVER_DNS_NAME contains unsupported characters" >&2
  exit 2
}
[[ "$SERVER_IP" =~ ^[0-9A-Fa-f:.]+$ ]] || {
  echo "error: SERVER_IP is not an IPv4/IPv6 literal" >&2
  exit 2
}
if [[ -e "$OUTPUT_DIR" ]] && [[ -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "error: output directory must be absent or empty: $OUTPUT_DIR" >&2
  exit 2
fi

install -d -m 0700 "$OUTPUT_DIR/private" "$OUTPUT_DIR/server" "$OUTPUT_DIR/client-assets"
readonly PRIVATE_DIR="$OUTPUT_DIR/private"
readonly SERVER_DIR="$OUTPUT_DIR/server"
readonly CLIENT_DIR="$OUTPUT_DIR/client-assets"

openssl req -x509 -newkey rsa:3072 -nodes \
  -keyout "$PRIVATE_DIR/ca.key" \
  -out "$PRIVATE_DIR/ca.pem" \
  -subj "/CN=Soma Quest v1a Development CA" \
  -days 30 -sha256

openssl req -newkey rsa:3072 -nodes \
  -keyout "$SERVER_DIR/server.key" \
  -out "$PRIVATE_DIR/server.csr" \
  -subj "/CN=$SERVER_DNS_NAME"
printf 'subjectAltName=DNS:%s,IP:%s\nextendedKeyUsage=serverAuth\n' \
  "$SERVER_DNS_NAME" "$SERVER_IP" >"$PRIVATE_DIR/server.ext"
openssl x509 -req \
  -in "$PRIVATE_DIR/server.csr" \
  -CA "$PRIVATE_DIR/ca.pem" \
  -CAkey "$PRIVATE_DIR/ca.key" \
  -CAcreateserial \
  -out "$SERVER_DIR/server.pem" \
  -days 30 -sha256 -extfile "$PRIVATE_DIR/server.ext"

openssl req -newkey rsa:3072 -nodes \
  -keyout "$PRIVATE_DIR/client.key" \
  -out "$PRIVATE_DIR/client.csr" \
  -subj "/CN=soma-quest-v1a-client"
printf 'extendedKeyUsage=clientAuth\n' >"$PRIVATE_DIR/client.ext"
openssl x509 -req \
  -in "$PRIVATE_DIR/client.csr" \
  -CA "$PRIVATE_DIR/ca.pem" \
  -CAkey "$PRIVATE_DIR/ca.key" \
  -CAcreateserial \
  -out "$PRIVATE_DIR/client.pem" \
  -days 30 -sha256 -extfile "$PRIVATE_DIR/client.ext"
openssl pkcs12 -export \
  -inkey "$PRIVATE_DIR/client.key" \
  -in "$PRIVATE_DIR/client.pem" \
  -certfile "$PRIVATE_DIR/ca.pem" \
  -name soma-quest-v1a-client \
  -out "$CLIENT_DIR/quest_client_identity.p12" \
  -passout "pass:$CLIENT_IDENTITY_PASSWORD"
install -m 0644 "$PRIVATE_DIR/ca.pem" "$SERVER_DIR/client-ca.pem"
install -m 0644 "$PRIVATE_DIR/ca.pem" "$CLIENT_DIR/quest_server_ca.pem"
chmod 0600 "$PRIVATE_DIR/ca.key" "$PRIVATE_DIR/client.key" "$SERVER_DIR/server.key" \
  "$CLIENT_DIR/quest_client_identity.p12"

readonly CLIENT_FINGERPRINT=$(openssl x509 -in "$PRIVATE_DIR/client.pem" -noout -fingerprint -sha256 \
  | sed 's/^sha256 Fingerprint=//I; s/://g')

echo "Created disposable 30-day v1a identities outside the repository."
echo "server_key=$SERVER_DIR/server.key"
echo "server_cert=$SERVER_DIR/server.pem"
echo "client_ca=$SERVER_DIR/client-ca.pem"
echo "client_assets=$CLIENT_DIR"
echo "client_fingerprint256=$CLIENT_FINGERPRINT"
