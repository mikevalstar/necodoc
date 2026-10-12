"""Smoke test for the necodoc Python SDK against a running deployment.

Renders HTML to a PDF, then (with NECODOC_TEMPLATE_ID) generates from a published template as
JSON and as a signing package.

    NECODOC_URL=http://localhost:3000 NECODOC_API_KEY=nd_... \\
    NECODOC_TEMPLATE_ID=<uuid> NECODOC_TEMPLATE_DATA='{"client_name": "Acme"}' \\
    python examples/smoke.py
"""

import json
import os

import necodoc
from necodoc.models import (
    GenerateRequest,
    GenerationResult,
    RenderRequest,
    RenderRequestHeader,
    SigningOptions,
    SigningPackage,
)

config = necodoc.Configuration(
    host=os.environ.get("NECODOC_URL", "http://localhost:3000").rstrip("/") + "/api/v1"
)
config.api_key["apiKey"] = os.environ["NECODOC_API_KEY"]

with necodoc.ApiClient(config) as client:
    # Render HTML to a PDF: the 200 body is the PDF's bytes.
    pdf = necodoc.RenderApi(client).post_render(
        RenderRequest(
            html="<h1>Invoice {{ number }}</h1>",
            data={"number": "A-1001"},
            footer=RenderRequestHeader(html="<p>{{ page }} / {{ pages }}</p>", height=12),
        )
    )
    with open("smoke-render.pdf", "wb") as file:
        file.write(pdf)
    print(f"render: {len(pdf)} bytes -> smoke-render.pdf")

    template_id = os.environ.get("NECODOC_TEMPLATE_ID")
    if not template_id:
        print("NECODOC_TEMPLATE_ID not set; skipping the template steps.")
        raise SystemExit(0)
    data = json.loads(os.environ.get("NECODOC_TEMPLATE_DATA", "{}"))
    templates = necodoc.TemplatesApi(client)

    try:
        # Generate as JSON: still bytes, parsed with the SDK's model (ADR 0041).
        body = templates.post_templates_by_id_versions_by_version_generate(
            template_id, "latest", GenerateRequest(data=data, response="json")
        )
        result = GenerationResult.from_json(body)
        print(f"generate: {result.generation_id}, {result.page_count} page(s), {result.download_url}")

        # A signing package instead of the PDF.
        body = templates.post_templates_by_id_versions_by_version_generate(
            template_id, "latest", GenerateRequest(data=data, signing=SigningOptions(True))
        )
        package = SigningPackage.from_json(body)
        print(f"signing: {len(package.signers)} signer(s), {len(package.boxes)} box(es)")

        # The same package later, typed directly: this endpoint only answers JSON.
        again = necodoc.GenerationsApi(client).get_generations_by_id_signing_package(
            package.generation_id, formats=["docusign"]
        )
        print(f"signing-package: {again.filename}, docusign: {again.formats.docusign is not None}")
    except necodoc.ApiException as error:
        # Non-2xx answers raise; the body is the API's error JSON (`fieldErrors` on 422).
        print(f"API error {error.status}: {error.body}")
        raise SystemExit(1) from error
