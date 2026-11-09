#!/usr/bin/env bash
# Download and extract the pinned FET release from the official Lalescu GitHub archive mirror.
# Upstream: https://github.com/lalesculiviu/fet  (commit c4f67a7b9a430033133cab602d60d85e90ccbd86 — FET-7.12.0)
set -euo pipefail

VERSION="7.12.0"
COMMIT="c4f67a7b9a430033133cab602d60d85e90ccbd86"
ARCHIVE="fet-${VERSION}.tar.xz"
RAW_URL="https://raw.githubusercontent.com/lalesculiviu/fet/main/${ARCHIVE}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVES="${ROOT}/vendor/archives"
SRC_ROOT="${ROOT}/vendor/fet-src"
ARCHIVE_PATH="${ARCHIVES}/${ARCHIVE}"
EXTRACTED="${SRC_ROOT}/fet-${VERSION}"

mkdir -p "${ARCHIVES}" "${SRC_ROOT}"
echo "FET pin: ${VERSION} (upstream commit ${COMMIT})"
echo "Downloading ${RAW_URL}"

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  curl -L --fail -o "${ARCHIVE_PATH}" "${RAW_URL}"
else
  echo "Archive already present: ${ARCHIVE_PATH}"
fi

curl -L --fail -o "${ARCHIVE_PATH}.asc" "${RAW_URL}.asc" || echo "Warning: .asc download failed (optional)"

rm -rf "${EXTRACTED}"
tar -xf "${ARCHIVE_PATH}" -C "${SRC_ROOT}"

cat > "${ROOT}/vendor/FET_PIN.json" <<EOF
{
  "version": "${VERSION}",
  "upstreamUrl": "https://github.com/lalesculiviu/fet",
  "upstreamCommit": "${COMMIT}",
  "archive": "${ARCHIVE}",
  "extracted": "vendor/fet-src/fet-${VERSION}",
  "homepage": "https://lalescu.ro/liviu/fet/"
}
EOF

echo "Done. Source at: ${EXTRACTED}"
echo "Next: build FET (CMake + Qt) so fet-cl exists, then export FET_CL_PATH if needed."
