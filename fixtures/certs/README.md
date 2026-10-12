# TEST-ONLY certificates

Throwaway identities for the certification tests
([ADR 0038](../../docs/adrs/0038-pades-certification-signatures-built-with-pki-js.md)).
The private keys are public on purpose: never trust these certificates or use them outside tests.

- `test-ca.cert.pem`: a self-signed CA (its key was discarded).
- `test-only.p12` (password `test-only`): an RSA 2048 certifier issued by that CA, with the chain.
  The same pair as PEM: `test-only.cert.pem`, `test-only.key.pem`.
- `test-only-ec.cert.pem`, `test-only-ec.key.pem`: a self-signed P-256 certifier.

Local dev: `CERTIFY_P12_PATH=../../fixtures/certs/test-only.p12 CERTIFY_PASSWORD=test-only`.
