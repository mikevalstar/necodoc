// Smoke test for the necodoc Java SDK against a running deployment. Renders HTML to a PDF, then
// (with NECODOC_TEMPLATE_ID) generates from a published template as JSON and as a signing package.
//
//   mvn -q compile dependency:build-classpath -Dmdep.outputFile=target/classpath.txt
//   NECODOC_URL=http://localhost:3000 NECODOC_API_KEY=nd_... \
//   NECODOC_TEMPLATE_ID=<uuid> NECODOC_TEMPLATE_DATA='{"client_name": "Acme"}' \
//   java -cp "target/classes:$(cat target/classpath.txt)" examples/Smoke.java

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.necodoc.sdk.ApiClient;
import dev.necodoc.sdk.ApiException;
import dev.necodoc.sdk.JSON;
import dev.necodoc.sdk.api.GenerationsApi;
import dev.necodoc.sdk.api.RenderApi;
import dev.necodoc.sdk.api.TemplatesApi;
import dev.necodoc.sdk.model.GenerateRequest;
import dev.necodoc.sdk.model.GenerationResult;
import dev.necodoc.sdk.model.GetGenerationsByIdSigningPackageFormatsParameterInner;
import dev.necodoc.sdk.model.RenderRequest;
import dev.necodoc.sdk.model.RenderRequestHeader;
import dev.necodoc.sdk.model.RenderRequestResponse;
import dev.necodoc.sdk.model.SigningOptions;
import dev.necodoc.sdk.model.SigningPackage;
import java.io.File;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class Smoke {
  public static void main(String[] args) throws Exception {
    String baseUrl = Objects.requireNonNullElse(System.getenv("NECODOC_URL"), "http://localhost:3000");
    String apiKey = Objects.requireNonNull(System.getenv("NECODOC_API_KEY"), "Set NECODOC_API_KEY");

    ApiClient client = new ApiClient();
    client.updateBaseUri(baseUrl.replaceAll("/+$", "") + "/api/v1");
    client.setRequestInterceptor(request -> request.header("x-api-key", apiKey));
    ObjectMapper json = JSON.getDefault().getMapper();

    try {
      // Render HTML to a PDF: the 200 body arrives as a temporary file.
      File pdf = new RenderApi(client).postRender(new RenderRequest()
          .html("<h1>Invoice {{ number }}</h1>")
          .data(Map.of("number", "A-1001"))
          .footer(new RenderRequestHeader().html("<p>{{ page }} / {{ pages }}</p>").height(BigDecimal.valueOf(12))));
      Files.copy(pdf.toPath(), Path.of("smoke-render.pdf"), StandardCopyOption.REPLACE_EXISTING);
      System.out.println("render: " + pdf.length() + " bytes -> smoke-render.pdf");

      String templateIdText = System.getenv("NECODOC_TEMPLATE_ID");
      if (templateIdText == null || templateIdText.isEmpty()) {
        System.out.println("NECODOC_TEMPLATE_ID not set; skipping the template steps.");
        return;
      }
      UUID templateId = UUID.fromString(templateIdText);
      Map<String, Object> data = json.readValue(
          Objects.requireNonNullElse(System.getenv("NECODOC_TEMPLATE_DATA"), "{}"),
          new TypeReference<Map<String, Object>>() {});
      TemplatesApi templates = new TemplatesApi(client);

      // Generate as JSON: still a file, parsed with the SDK's model (ADR 0041).
      File body = templates.postTemplatesByIdVersionsByVersionGenerate(templateId, "latest",
          new GenerateRequest().data(data).response(RenderRequestResponse.JSON));
      GenerationResult result = json.readValue(body, GenerationResult.class);
      System.out.println("generate: " + result.getGenerationId() + ", " + result.getPageCount()
          + " page(s), " + result.getDownloadUrl());

      // A signing package instead of the PDF.
      body = templates.postTemplatesByIdVersionsByVersionGenerate(templateId, "latest",
          new GenerateRequest().data(data).signing(new SigningOptions(true)));
      SigningPackage signing = json.readValue(body, SigningPackage.class);
      System.out.println("signing: " + signing.getSigners().size() + " signer(s), "
          + signing.getBoxes().size() + " box(es)");

      // The same package later, typed directly: this endpoint only answers JSON.
      SigningPackage again = new GenerationsApi(client).getGenerationsByIdSigningPackage(
          signing.getGenerationId(),
          List.of(GetGenerationsByIdSigningPackageFormatsParameterInner.DOCUSIGN), null, null);
      System.out.println("signing-package: " + again.getFilename() + ", docusign: "
          + (again.getFormats().getDocusign() != null));
    } catch (ApiException error) {
      // Non-2xx answers throw; the body is the API's error JSON (`fieldErrors` on 422).
      System.err.println("API error " + error.getCode() + ": " + error.getResponseBody());
      System.exit(1);
    }
  }
}
