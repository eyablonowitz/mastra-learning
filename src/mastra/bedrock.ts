import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-5";

export const BEDROCK_REGION =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

const bedrock = createAmazonBedrock({
  region: BEDROCK_REGION,
  credentialProvider: fromNodeProviderChain(),
});

export function getBedrockModel() {
  return bedrock(BEDROCK_MODEL_ID);
}
